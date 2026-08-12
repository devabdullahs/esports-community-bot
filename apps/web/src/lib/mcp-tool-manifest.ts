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
  /** Only meaningful for write tools: does a call overwrite existing state? */
  destructive?: boolean;
  adminGrant: McpToolAdminGrant;
  scope: McpToolScope;
  title: Record<Locale, string>;
  description: Record<Locale, string>;
};

export type McpToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
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

// Tool annotations tell a client whether a call needs a human in the loop.
// Deriving them from the manifest — which already declares read vs write and is
// tested against the real registrations — keeps a hint from ever disagreeing
// with what the tool does. Hand-written per registration, they would drift, and
// a stale `readOnlyHint: true` on a write is exactly the wrong way to be wrong.
export function mcpToolAnnotations(name: string): McpToolAnnotations {
  const entry = getMcpToolManifestEntry(name);
  if (!entry) {
    // An unknown tool gets the answer that keeps a human in the loop.
    return {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    };
  }

  const readOnly = entry.kind === "read";
  return {
    readOnlyHint: readOnly,
    // Reads change nothing. A write is destructive unless the manifest says it
    // is purely additive — absent means "assume the worse of the two".
    destructiveHint: readOnly ? false : entry.destructive !== false,
    // Reads are naturally repeatable, and every write tool takes a required
    // idempotencyKey, so the same arguments genuinely produce no second effect.
    idempotentHint: true,
    // Every tool answers from this project's own database. None reaches out to
    // an open set of external entities at call time.
    openWorldHint: false,
  };
}
