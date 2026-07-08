import type { Locale } from "@/lib/i18n";

export function buildMcpAssistantPrompt(docsUrl: string, locale: Locale = "en") {
  if (locale === "ar") {
    return (
      `أقرأ الآن شرح Esports Community admin MCP هنا: ${docsUrl}.\n` +
      "ساعدني في فهم طريقة استخدامه. كن مستعدا لشرح المفاهيم، إعطاء أمثلة، أو المساعدة في حل المشاكل بناء على هذا الشرح.\n  "
    );
  }

  return (
    `I'm looking at this Esports Community admin MCP documentation: ${docsUrl}.\n` +
    "Help me understand how to use it. Be ready to explain concepts, give examples, or help debug based on it.\n  "
  );
}

export function buildMcpAssistantUrl(baseUrl: string, docsUrl: string, locale: Locale = "en") {
  const target = new URL(baseUrl);
  target.searchParams.set("q", buildMcpAssistantPrompt(docsUrl, locale));
  return target.toString();
}
