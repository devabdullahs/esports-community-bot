// Pure selection model for the MCP key creation form (plan 075).
// React-free on purpose so node Vitest can exercise every preset and
// validation rule. All tool names come from the shared manifest — never
// duplicate name literals here.
import {
  ADMIN_SELECTABLE_MCP_TOOL_NAMES,
  MCP_TOOL_MANIFEST,
  MCP_WRITE_TOOL_NAMES,
} from "@/lib/mcp-tool-manifest";

export type McpKeyPurpose = "research" | "news" | "stream" | "custom";
export type McpScopeKind = "games" | "media";

export type McpKeySelection = {
  purpose: McpKeyPurpose;
  tools: string[];
  games: string[];
  media: string[];
};

const SELECTABLE = new Set<string>(ADMIN_SELECTABLE_MCP_TOOL_NAMES);
const WRITES = new Set<string>(MCP_WRITE_TOOL_NAMES);

const NEWS_WRITE = "create_news_draft";
const STREAM_WRITE = "update_stream_channel";

const SELECTABLE_READS = MCP_TOOL_MANIFEST.filter(
  (tool) =>
    tool.surfaces.includes("admin") &&
    tool.adminGrant === "selectable" &&
    tool.kind === "read",
).map((tool) => tool.name);

// Purpose presets. Research is the least-privilege default: reads only,
// no scopes. Write purposes add exactly one write tool plus the reads an
// assistant needs to use it sensibly.
function presetTools(purpose: Exclude<McpKeyPurpose, "custom">): string[] {
  if (purpose === "research") return [...SELECTABLE_READS];
  if (purpose === "news") {
    return ["search_news", "get_site_overview", NEWS_WRITE].filter((name) => SELECTABLE.has(name));
  }
  return ["get_tournament_status", STREAM_WRITE].filter((name) => SELECTABLE.has(name));
}

export function defaultMcpKeySelection(): McpKeySelection {
  return { purpose: "research", tools: presetTools("research"), games: [], media: [] };
}

export function applyPurpose(selection: McpKeySelection, purpose: McpKeyPurpose): McpKeySelection {
  if (purpose === "custom") return { ...selection, purpose: "custom" };
  return { ...selection, purpose, tools: presetTools(purpose) };
}

// Toggling a tool always lands in Custom: the user has diverged from the
// preset. Non-selectable (always-on/public) names are ignored — they are
// never stored on a key.
export function toggleTool(selection: McpKeySelection, name: string): McpKeySelection {
  if (!SELECTABLE.has(name)) return selection;
  const tools = selection.tools.includes(name)
    ? selection.tools.filter((tool) => tool !== name)
    : [...selection.tools, name];
  return { ...selection, purpose: "custom", tools };
}

export function toggleScope(
  selection: McpKeySelection,
  kind: McpScopeKind,
  slug: string,
): McpKeySelection {
  const current = selection[kind];
  const next = current.includes(slug)
    ? current.filter((value) => value !== slug)
    : [...current, slug];
  return { ...selection, [kind]: next };
}

// "Select all visible" for the searchable picker: adds the given slugs
// (typically the filtered result set) without dropping prior choices.
export function selectScopes(
  selection: McpKeySelection,
  kind: McpScopeKind,
  slugs: string[],
): McpKeySelection {
  const merged = [...new Set([...selection[kind], ...slugs])];
  return { ...selection, [kind]: merged };
}

export function clearScopes(selection: McpKeySelection, kind: McpScopeKind): McpKeySelection {
  return { ...selection, [kind]: [] };
}

export function selectionHasWrite(selection: McpKeySelection): boolean {
  return selection.tools.some((tool) => WRITES.has(tool));
}

export type McpKeySelectionError =
  | "no-tools"
  | "news-needs-scope"
  | "stream-needs-game"
  | "expiry-past";

// Validation is write-tool based (not purpose based) so a Custom selection
// carrying a write tool has the same scope requirements as the preset.
export function validateMcpKeySelection(
  selection: McpKeySelection,
  { expiresAt = null, nowSec = Math.floor(Date.now() / 1000) }: {
    expiresAt?: number | null;
    nowSec?: number;
  } = {},
): { ok: true } | { ok: false; error: McpKeySelectionError } {
  if (selection.tools.length === 0) return { ok: false, error: "no-tools" };
  if (selection.tools.includes(NEWS_WRITE) && selection.games.length === 0 && selection.media.length === 0) {
    return { ok: false, error: "news-needs-scope" };
  }
  if (selection.tools.includes(STREAM_WRITE) && selection.games.length === 0) {
    return { ok: false, error: "stream-needs-game" };
  }
  if (expiresAt !== null && expiresAt <= nowSec) return { ok: false, error: "expiry-past" };
  return { ok: true };
}
