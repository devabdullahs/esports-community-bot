import { MCP_TOOL_MANIFEST as RAW_MCP_TOOL_MANIFEST } from "@bot/lib/mcpToolManifest.js";
import type { Locale } from "@/lib/i18n";

export type McpToolSurface = "public" | "admin";
export type McpToolKind = "read" | "write";
export type McpToolAdminGrant = "always" | "selectable";
export type McpToolScope = "none" | "game" | "media" | "game-or-media" | "stream-game";

export type McpToolManifestEntry = {
  name: string;
  surfaces: readonly McpToolSurface[];
  kind: McpToolKind;
  adminGrant: McpToolAdminGrant;
  scope: McpToolScope;
  title: Record<Locale, string>;
  description: Record<Locale, string>;
};

export const MCP_TOOL_MANIFEST = RAW_MCP_TOOL_MANIFEST as readonly McpToolManifestEntry[];

function namesWhere(predicate: (tool: McpToolManifestEntry) => boolean) {
  return Object.freeze(MCP_TOOL_MANIFEST.filter(predicate).map((tool) => tool.name));
}

export const PUBLIC_MCP_TOOL_NAMES = namesWhere((tool) => tool.surfaces.includes("public"));
export const ADMIN_MCP_TOOL_NAMES = namesWhere((tool) => tool.surfaces.includes("admin"));
export const ADMIN_ALWAYS_ON_MCP_TOOL_NAMES = namesWhere(
  (tool) => tool.surfaces.includes("admin") && tool.adminGrant === "always",
);
export const ADMIN_SELECTABLE_MCP_TOOL_NAMES = namesWhere(
  (tool) => tool.surfaces.includes("admin") && tool.adminGrant === "selectable",
);
export const PUBLIC_ONLY_MCP_TOOL_NAMES = namesWhere(
  (tool) => tool.surfaces.includes("public") && tool.surfaces.includes("admin") && tool.adminGrant === "always",
);
export const ADMIN_PUBLIC_OVERLAP_TOOL_NAMES = namesWhere(
  (tool) => tool.surfaces.includes("public") && tool.surfaces.includes("admin") && tool.adminGrant === "selectable",
);
export const MCP_WRITE_TOOL_NAMES = namesWhere((tool) => tool.kind === "write");

export function getMcpToolManifestEntry(name: string) {
  return MCP_TOOL_MANIFEST.find((tool) => tool.name === name) ?? null;
}
