export function buildMcpAssistantPrompt(docsUrl: string) {
  return (
    `I'm looking at this Esports Community admin MCP documentation: ${docsUrl}.\n` +
    "Help me understand how to use it. Be ready to explain concepts, give examples, or help debug based on it.\n  "
  );
}

export function buildMcpAssistantUrl(baseUrl: string, docsUrl: string) {
  const target = new URL(baseUrl);
  target.searchParams.set("q", buildMcpAssistantPrompt(docsUrl));
  return target.toString();
}
