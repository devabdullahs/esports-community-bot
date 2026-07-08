import type { Locale } from "@/lib/i18n";

export type McpAssistantKind = "admin" | "public";

function arabicAdminPrompt(docsUrl: string) {
  return (
    `\u0623\u0642\u0631\u0623 \u0627\u0644\u0622\u0646 \u0634\u0631\u062d Esports Community admin MCP \u0647\u0646\u0627: ${docsUrl}.\n` +
    "\u0633\u0627\u0639\u062f\u0646\u064a \u0641\u064a \u0641\u0647\u0645 \u0637\u0631\u064a\u0642\u0629 \u0627\u0633\u062a\u062e\u062f\u0627\u0645\u0647. \u0643\u0646 \u0645\u0633\u062a\u0639\u062f\u0627 \u0644\u0634\u0631\u062d \u0627\u0644\u0645\u0641\u0627\u0647\u064a\u0645\u060c \u0625\u0639\u0637\u0627\u0621 \u0623\u0645\u062b\u0644\u0629\u060c \u0623\u0648 \u0627\u0644\u0645\u0633\u0627\u0639\u062f\u0629 \u0641\u064a \u062d\u0644 \u0627\u0644\u0645\u0634\u0627\u0643\u0644 \u0628\u0646\u0627\u0621 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u0634\u0631\u062d.\n  "
  );
}

function arabicPublicPrompt(docsUrl: string) {
  return (
    `\u0623\u0642\u0631\u0623 \u0627\u0644\u0622\u0646 \u0634\u0631\u062d Esports Community public MCP \u0647\u0646\u0627: ${docsUrl}.\n` +
    "\u0633\u0627\u0639\u062f\u0646\u064a \u0641\u064a \u0641\u0647\u0645 \u0637\u0631\u064a\u0642\u0629 \u0627\u0633\u062a\u062e\u062f\u0627\u0645 \u0623\u062f\u0648\u0627\u062a\u0647 \u0627\u0644\u0639\u0627\u0645\u0629 \u0644\u0644\u0642\u0631\u0627\u0621\u0629 \u0641\u0642\u0637. \u0643\u0646 \u0645\u0633\u062a\u0639\u062f\u0627 \u0644\u0634\u0631\u062d \u0627\u0644\u0623\u0645\u062b\u0644\u0629 \u0623\u0648 \u0627\u0644\u0645\u0633\u0627\u0639\u062f\u0629 \u0641\u064a \u0627\u0644\u062a\u062c\u0631\u0628\u0629.\n  "
  );
}

export function buildMcpAssistantPrompt(
  docsUrl: string,
  locale: Locale = "en",
  kind: McpAssistantKind = "admin",
) {
  if (locale === "ar") {
    return kind === "public" ? arabicPublicPrompt(docsUrl) : arabicAdminPrompt(docsUrl);
  }

  if (kind === "public") {
    return (
      `I'm looking at this Esports Community public MCP documentation: ${docsUrl}.\n` +
      "Help me understand how to use the read-only public tools. Be ready to explain concepts, give examples, or help debug based on it.\n  "
    );
  }

  return (
    `I'm looking at this Esports Community admin MCP documentation: ${docsUrl}.\n` +
    "Help me understand how to use it. Be ready to explain concepts, give examples, or help debug based on it.\n  "
  );
}

export function buildMcpAssistantUrl(
  baseUrl: string,
  docsUrl: string,
  locale: Locale = "en",
  kind: McpAssistantKind = "admin",
) {
  const target = new URL(baseUrl);
  target.searchParams.set("q", buildMcpAssistantPrompt(docsUrl, locale, kind));
  return target.toString();
}
