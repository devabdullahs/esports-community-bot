import { describe, expect, test } from "vitest";
import {
  applyPurpose,
  clearScopes,
  defaultMcpKeySelection,
  selectionHasWrite,
  selectScopes,
  toggleScope,
  toggleTool,
  validateMcpKeySelection,
} from "@/lib/mcp-key-selection";
import {
  ADMIN_ALWAYS_ON_MCP_TOOL_NAMES,
  ADMIN_SELECTABLE_MCP_TOOL_NAMES,
  MCP_WRITE_TOOL_NAMES,
} from "@/lib/mcp-tool-manifest";

const SELECTABLE = new Set<string>(ADMIN_SELECTABLE_MCP_TOOL_NAMES);
const WRITES = new Set<string>(MCP_WRITE_TOOL_NAMES);

describe("mcp key selection model", () => {
  test("default is research: selectable reads only, empty scopes", () => {
    const sel = defaultMcpKeySelection();
    expect(sel.purpose).toBe("research");
    expect(sel.games).toEqual([]);
    expect(sel.media).toEqual([]);
    expect(sel.tools.length).toBeGreaterThan(0);
    for (const tool of sel.tools) {
      expect(SELECTABLE.has(tool)).toBe(true);
      expect(WRITES.has(tool)).toBe(false);
    }
    expect(selectionHasWrite(sel)).toBe(false);
    expect(validateMcpKeySelection(sel)).toEqual({ ok: true });
  });

  test("news preset adds exactly the news write tool", () => {
    const sel = applyPurpose(defaultMcpKeySelection(), "news");
    expect(sel.purpose).toBe("news");
    expect(sel.tools).toContain("create_news_draft");
    expect(sel.tools).not.toContain("update_stream_channel");
    expect(sel.tools.every((tool) => SELECTABLE.has(tool))).toBe(true);
    expect(selectionHasWrite(sel)).toBe(true);
  });

  test("stream preset adds exactly the stream write tool", () => {
    const sel = applyPurpose(defaultMcpKeySelection(), "stream");
    expect(sel.tools).toContain("update_stream_channel");
    expect(sel.tools).not.toContain("create_news_draft");
    expect(sel.tools.every((tool) => SELECTABLE.has(tool))).toBe(true);
  });

  test("presets never include always-on or unknown tools", () => {
    for (const purpose of ["research", "news", "stream"] as const) {
      const sel = applyPurpose(defaultMcpKeySelection(), purpose);
      for (const tool of sel.tools) {
        expect(ADMIN_ALWAYS_ON_MCP_TOOL_NAMES.includes(tool)).toBe(false);
      }
    }
  });

  test("toggling a tool moves to custom and preserves manual choices", () => {
    const research = defaultMcpKeySelection();
    const custom = toggleTool(research, "create_news_draft");
    expect(custom.purpose).toBe("custom");
    expect(custom.tools).toContain("create_news_draft");
    // Re-applying custom keeps the manual tool list intact.
    expect(applyPurpose(custom, "custom").tools).toEqual(custom.tools);
    // Toggling off removes it and stays custom.
    const off = toggleTool(custom, "create_news_draft");
    expect(off.tools).not.toContain("create_news_draft");
    expect(off.purpose).toBe("custom");
  });

  test("always-on tool names cannot be stored as selections", () => {
    const sel = defaultMcpKeySelection();
    for (const name of ADMIN_ALWAYS_ON_MCP_TOOL_NAMES) {
      expect(toggleTool(sel, name)).toBe(sel);
    }
    expect(toggleTool(sel, "not_a_tool")).toBe(sel);
  });

  test("scope toggles, bulk select, and clear", () => {
    let sel = defaultMcpKeySelection();
    sel = toggleScope(sel, "games", "valorant");
    sel = toggleScope(sel, "media", "newsroom");
    expect(sel.games).toEqual(["valorant"]);
    expect(sel.media).toEqual(["newsroom"]);
    sel = selectScopes(sel, "games", ["valorant", "dota2", "cs2"]);
    expect(sel.games.sort()).toEqual(["cs2", "dota2", "valorant"]);
    sel = toggleScope(sel, "games", "dota2");
    expect(sel.games).not.toContain("dota2");
    sel = clearScopes(sel, "games");
    expect(sel.games).toEqual([]);
    expect(sel.media).toEqual(["newsroom"]);
  });

  test("validation: zero tools rejected", () => {
    let sel = defaultMcpKeySelection();
    for (const tool of [...sel.tools]) sel = toggleTool(sel, tool);
    expect(validateMcpKeySelection(sel)).toEqual({ ok: false, error: "no-tools" });
  });

  test("validation: news write requires a game or media scope", () => {
    const sel = applyPurpose(defaultMcpKeySelection(), "news");
    expect(validateMcpKeySelection(sel)).toEqual({ ok: false, error: "news-needs-scope" });
    expect(validateMcpKeySelection(toggleScope(sel, "games", "valorant"))).toEqual({ ok: true });
    expect(validateMcpKeySelection(toggleScope(sel, "media", "newsroom"))).toEqual({ ok: true });
  });

  test("validation: stream write requires a game scope (media does not count)", () => {
    const sel = applyPurpose(defaultMcpKeySelection(), "stream");
    expect(validateMcpKeySelection(sel)).toEqual({ ok: false, error: "stream-needs-game" });
    expect(validateMcpKeySelection(toggleScope(sel, "media", "newsroom"))).toEqual({
      ok: false,
      error: "stream-needs-game",
    });
    expect(validateMcpKeySelection(toggleScope(sel, "games", "valorant"))).toEqual({ ok: true });
  });

  test("validation applies write rules to custom selections too", () => {
    const sel = toggleTool(defaultMcpKeySelection(), "update_stream_channel");
    expect(validateMcpKeySelection(sel)).toEqual({ ok: false, error: "stream-needs-game" });
  });

  test("validation: expiry must be in the future", () => {
    const sel = defaultMcpKeySelection();
    expect(validateMcpKeySelection(sel, { expiresAt: 100, nowSec: 200 })).toEqual({
      ok: false,
      error: "expiry-past",
    });
    expect(validateMcpKeySelection(sel, { expiresAt: 300, nowSec: 200 })).toEqual({ ok: true });
    expect(validateMcpKeySelection(sel, { expiresAt: null, nowSec: 200 })).toEqual({ ok: true });
  });
});
