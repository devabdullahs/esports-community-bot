import { describe, expect, it } from "vitest";
import { buildMcpAssistantUrl } from "@/lib/mcp-assistant-links";

describe("MCP assistant links", () => {
  const docsUrl = "https://esportscommunity.net/docs/admin-mcp";

  it.each([
    ["ChatGPT", "https://chatgpt.com/", "https://chatgpt.com/"],
    ["v0", "https://v0.dev/", "https://v0.dev/"],
    ["Claude", "https://claude.ai/new", "https://claude.ai/new"],
    ["Scira", "https://scira.ai/", "https://scira.ai/"],
  ])("builds a shadcn-style q link for %s", (_name, baseUrl, expectedBase) => {
    const url = new URL(buildMcpAssistantUrl(baseUrl, docsUrl));

    expect(`${url.origin}${url.pathname}`).toBe(expectedBase);
    expect(url.searchParams.get("q")).toContain(
      `I'm looking at this Esports Community admin MCP documentation: ${docsUrl}.`,
    );
    expect(url.searchParams.get("q")).not.toContain("/admin/mcp/docs");
    expect(url.searchParams.get("q")).toContain("Help me understand how to use it.");
  });
});
