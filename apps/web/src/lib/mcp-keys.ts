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

export function toMcpKeyDto(value: McpKey): McpKey {
  return {
    id: value.id,
    keyPrefix: value.keyPrefix,
    label: value.label,
    ownerDiscordId: value.ownerDiscordId,
    ownerName: value.ownerName,
    tools: value.tools,
    games: value.games,
    media: value.media,
    expiresAt: value.expiresAt,
    revokedAt: value.revokedAt,
    lastUsedAt: value.lastUsedAt,
    createdBy: value.createdBy,
    createdAt: value.createdAt,
  };
}

export function listMcpKeys(): Promise<McpKey[]> {
  return list().then((keys) => keys.map(toMcpKeyDto));
}

export async function getMcpKey(id: number): Promise<McpKey | null> {
  const key = await getOne(id);
  return key ? toMcpKeyDto(key) : null;
}

export async function createMcpKey(input: Parameters<typeof create>[0]) {
  const created = await create(input);
  return { key: toMcpKeyDto(created.key), secret: created.secret };
}

export function revokeMcpKey(id: number) {
  return revoke(id);
}
