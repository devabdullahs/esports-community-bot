import "server-only";

import {
  MCP_TOOL_NAMES,
  createMcpKey as _create,
  getMcpKey as _get,
  listMcpKeys as _list,
  revokeMcpKey as _revoke,
} from "@bot/db/mcpKeys.js";

export { MCP_TOOL_NAMES };

export type McpKey = {
  id: number;
  keyPrefix: string;
  label: string;
  ownerDiscordId: string;
  ownerName: string | null;
  tools: string[];
  games: string[];
  media: string[];
  expiresAt: number | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdBy: string | null;
  createdAt: string;
};

const list = _list as () => Promise<McpKey[]>;
const getOne = _get as (id: number) => Promise<McpKey | null>;
const create = _create as (input: {
  label?: string;
  ownerDiscordId: string;
  ownerName?: string | null;
  tools?: string[];
  games?: string[];
  media?: string[];
  expiresAt?: number | null;
  createdBy?: string | null;
}) => Promise<{ key: McpKey; secret: string }>;
const revoke = _revoke as (id: number) => Promise<{ revoked: number }>;

export function listMcpKeys(): Promise<McpKey[]> {
  return list();
}

export function getMcpKey(id: number): Promise<McpKey | null> {
  return getOne(id);
}

export function createMcpKey(input: Parameters<typeof create>[0]) {
  return create(input);
}

export function revokeMcpKey(id: number) {
  return revoke(id);
}
