import "server-only";

import { createHash } from "node:crypto";

import { transaction } from "@bot/db/client.js";
import { recordAdminAudit } from "@bot/db/ewcAdminAuditLog.js";
import {
  claimMcpWriteReceipt,
  completeMcpWriteReceipt,
  getMcpWriteReceipt,
} from "@bot/db/mcpWriteReceipts.js";
import { mcpAuditActor, type McpAccess } from "@/lib/mcp-auth";

export type DbTxClient = {
  all(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  get(sql: string, params?: unknown[]): Promise<Record<string, unknown> | null>;
  run(sql: string, params?: unknown[]): Promise<{ changes?: number; rowCount?: number }>;
  exec?(sql: string): Promise<void>;
};

type ReceiptResult = Record<string, unknown>;

type MutationResult<TReceipt extends ReceiptResult> = {
  result: TReceipt;
  auditTarget: string | null;
  auditDetails?: Record<string, unknown> | null;
};

type HookContext = {
  toolName: string;
  keyId: number;
  idempotencyKey: string;
};

type McpWriteTestHooks = {
  wrapTx?: (tx: DbTxClient, context: HookContext) => DbTxClient;
  beforeAudit?: (context: HookContext & { result: ReceiptResult }) => void | Promise<void>;
};

let testHooks: McpWriteTestHooks = {};

const recordAuditInTx = recordAdminAudit as unknown as (
  params: {
    actorId: string;
    actorName: string | null;
    action: string;
    target: string | null;
    details: Record<string, unknown> | null;
  },
  tx: DbTxClient,
) => Promise<void>;

export function setMcpWriteTestHooksForTests(hooks: McpWriteTestHooks) {
  testHooks = hooks;
  return () => {
    if (testHooks === hooks) testHooks = {};
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

// Canonical digest binding a receipt to the exact requested operation: the
// same idempotency key with a DIFFERENT payload must never replay another
// request's result (ECB-SEC-014 hardening).
export function canonicalRequestDigest(toolName: string, args: Record<string, unknown>): string {
  return createHash("sha256").update(`${toolName}\n${stableStringify(args)}`).digest("hex");
}

export async function runIdempotentMcpWrite<TReceipt extends ReceiptResult, THydrated>({
  access,
  toolName,
  idempotencyKey,
  requestDigest,
  auditAction,
  mutate,
  hydrate,
  reauthorizeReplay,
}: {
  access: McpAccess;
  toolName: string;
  idempotencyKey: string;
  requestDigest: string;
  auditAction: string;
  mutate: (tx: DbTxClient) => Promise<MutationResult<TReceipt>>;
  hydrate: (result: TReceipt) => Promise<THydrated>;
  // Replays re-run final-object authorization against the CURRENT access:
  // a key whose scopes were reduced (or whose owner lost a scope) since the
  // original write must not receive the hydrated resource again.
  reauthorizeReplay: (value: THydrated) => boolean | Promise<boolean>;
}): Promise<{ value: THydrated; result: TReceipt; replayed: boolean }> {
  const receiptKey = { keyId: access.key.id, toolName, idempotencyKey };
  const context = { toolName, keyId: access.key.id, idempotencyKey };

  const committed = await transaction(async (tx: DbTxClient) => {
    const claimed = await claimMcpWriteReceipt(tx, receiptKey, { requestDigest });
    if (!claimed.claimed) {
      const receipt = await getMcpWriteReceipt(tx, receiptKey);
      if (!receipt?.completed) throw new Error("MCP write receipt is not complete; retry the request.");
      // Fail closed on payload mismatch AND on legacy receipts without a
      // stored digest — an unverifiable binding is not a binding.
      if (!receipt.requestDigest || receipt.requestDigest !== requestDigest) {
        throw new Error("This idempotency key was already used with a different request payload.");
      }
      return { result: receipt.result as TReceipt, replayed: true };
    }

    const mutationTx = testHooks.wrapTx?.(tx, context) ?? tx;
    const mutation = await mutate(mutationTx);
    await testHooks.beforeAudit?.({ ...context, result: mutation.result });

    const actor = mcpAuditActor(access);
    await recordAuditInTx({
      ...actor,
      action: auditAction,
      target: mutation.auditTarget,
      details: {
        ...(mutation.auditDetails ?? {}),
        keyId: access.key.id,
        keyPrefix: access.key.keyPrefix,
        ownerDiscordId: access.discordUserId,
      },
    }, tx);
    await completeMcpWriteReceipt(tx, receiptKey, mutation.result);
    return { result: mutation.result, replayed: false };
  });

  const value = await hydrate(committed.result);
  if (committed.replayed && !(await reauthorizeReplay(value))) {
    throw new Error("This MCP key is no longer authorized for the resource behind this idempotency key.");
  }
  return { value, result: committed.result, replayed: committed.replayed };
}
