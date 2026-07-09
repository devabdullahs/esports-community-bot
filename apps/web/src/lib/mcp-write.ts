import "server-only";

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

export async function runIdempotentMcpWrite<TReceipt extends ReceiptResult, THydrated>({
  access,
  toolName,
  idempotencyKey,
  auditAction,
  mutate,
  hydrate,
}: {
  access: McpAccess;
  toolName: string;
  idempotencyKey: string;
  auditAction: string;
  mutate: (tx: DbTxClient) => Promise<MutationResult<TReceipt>>;
  hydrate: (result: TReceipt) => Promise<THydrated>;
}): Promise<{ value: THydrated; result: TReceipt; replayed: boolean }> {
  const receiptKey = { keyId: access.key.id, toolName, idempotencyKey };
  const context = { toolName, keyId: access.key.id, idempotencyKey };

  const committed = await transaction(async (tx: DbTxClient) => {
    const claimed = await claimMcpWriteReceipt(tx, receiptKey);
    if (!claimed.claimed) {
      const receipt = await getMcpWriteReceipt(tx, receiptKey);
      if (!receipt?.completed) throw new Error("MCP write receipt is not complete; retry the request.");
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

  return {
    value: await hydrate(committed.result),
    result: committed.result,
    replayed: committed.replayed,
  };
}
