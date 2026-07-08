import { describe, expect, it } from "vitest";
import { getAdminMcpCopyPage } from "@/lib/admin-mcp-copy-page";
import { buildMcpAssistantUrl } from "@/lib/mcp-assistant-links";
import { getPublicMcpCopyPage } from "@/lib/public-mcp-copy-page";

describe("MCP assistant links", () => {
  const adminDocsUrl = "https://esportscommunity.net/docs/admin-mcp";
  const publicDocsUrl = "https://esportscommunity.net/docs/mcp";

  it.each([
    ["ChatGPT", "https://chatgpt.com/", "https://chatgpt.com/"],
    ["v0", "https://v0.dev/", "https://v0.dev/"],
    ["Claude", "https://claude.ai/new", "https://claude.ai/new"],
    ["Scira", "https://scira.ai/", "https://scira.ai/"],
  ])("builds a shadcn-style admin q link for %s", (_name, baseUrl, expectedBase) => {
    const url = new URL(buildMcpAssistantUrl(baseUrl, adminDocsUrl));

    expect(`${url.origin}${url.pathname}`).toBe(expectedBase);
    expect(url.searchParams.get("q")).toContain(
      `I'm looking at this Esports Community admin MCP documentation: ${adminDocsUrl}.`,
    );
    expect(url.searchParams.get("q")).not.toContain("/admin/mcp/docs");
    expect(url.searchParams.get("q")).toContain("Help me understand how to use it.");
  });

  it("builds a public read-only assistant prompt", () => {
    const url = new URL(buildMcpAssistantUrl("https://chatgpt.com/", publicDocsUrl, "en", "public"));

    expect(url.searchParams.get("q")).toContain(
      `I'm looking at this Esports Community public MCP documentation: ${publicDocsUrl}.`,
    );
    expect(url.searchParams.get("q")).toContain("read-only public tools");
    expect(url.searchParams.get("q")).not.toContain("admin MCP documentation");
  });

  it("builds Arabic assistant prompts for Arabic docs", () => {
    const arabicDocsUrl = "https://esportscommunity.net/ar/docs/admin-mcp";
    const url = new URL(buildMcpAssistantUrl("https://chatgpt.com/", arabicDocsUrl, "ar"));

    expect(url.searchParams.get("q")).toContain(`شرح Esports Community admin MCP هنا: ${arabicDocsUrl}.`);
    expect(url.searchParams.get("q")).toContain("ساعدني في فهم طريقة استخدامه.");
    expect(url.searchParams.get("q")).not.toContain("I'm looking at this");
  });

  it("exposes localized MCP markdown copy", () => {
    expect(getAdminMcpCopyPage("en")).toContain("# Admin MCP");
    expect(getAdminMcpCopyPage("en")).toContain("all public read-only tools");
    expect(getAdminMcpCopyPage("en")).toContain("list_games");
    expect(getAdminMcpCopyPage("ar")).toContain("# خادم MCP الإداري");

    expect(getPublicMcpCopyPage("en")).toContain("# Public MCP");
    expect(getPublicMcpCopyPage("en")).toContain("https://esportscommunity.net/api/public-mcp");
    expect(getPublicMcpCopyPage("en")).toContain("trusted edge IP");
    expect(getPublicMcpCopyPage("ar")).toContain("# خادم MCP العام");
    expect(getPublicMcpCopyPage("ar")).toContain("للقراءة فقط");
    expect(getPublicMcpCopyPage("ar")).toContain("IP الموثوق");
  });
});
