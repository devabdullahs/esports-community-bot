import { describe, expect, it } from "vitest";
import { getAdminMcpCopyPage } from "@/lib/admin-mcp-copy-page";
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

  it("builds Arabic assistant prompts for Arabic docs", () => {
    const arabicDocsUrl = "https://esportscommunity.net/ar/docs/admin-mcp";
    const url = new URL(buildMcpAssistantUrl("https://chatgpt.com/", arabicDocsUrl, "ar"));

    expect(url.searchParams.get("q")).toContain(`أقرأ الآن شرح Esports Community admin MCP هنا: ${arabicDocsUrl}.`);
    expect(url.searchParams.get("q")).toContain("ساعدني في فهم طريقة استخدامه.");
    expect(url.searchParams.get("q")).not.toContain("I'm looking at this");
  });

  it("exposes localized admin MCP markdown copy", () => {
    expect(getAdminMcpCopyPage("en")).toContain("# Admin MCP");
    expect(getAdminMcpCopyPage("ar")).toContain("# MCP الإداري");
    expect(getAdminMcpCopyPage("ar")).toContain("## ملاحظات الأمان");
  });
});
