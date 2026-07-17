export const GRAPHICS_TEMPLATES = [
  { id: "match-result", label: "Match result", source: "matches" },
  { id: "standings", label: "Standings", source: "standings" },
  { id: "news-promo", label: "News promo", source: "news" },
] as const;

export type GraphicsTemplateId = (typeof GRAPHICS_TEMPLATES)[number]["id"];
export type GraphicsSourceKind = (typeof GRAPHICS_TEMPLATES)[number]["source"];

export type GraphicsOwner =
  | { kind: "game"; slug: string }
  | { kind: "media"; slug: string };

export type GraphicsOption = {
  id: number;
  label: string;
  detail: string;
  owner: GraphicsOwner;
};

export type GraphicsGeneratorData = {
  matches: GraphicsOption[];
  standings: GraphicsOption[];
  news: GraphicsOption[];
};

export type GraphicsRenderRequest = {
  template: GraphicsTemplateId;
  resourceId: number;
};

export function isGraphicsTemplateId(value: unknown): value is GraphicsTemplateId {
  return GRAPHICS_TEMPLATES.some((template) => template.id === value);
}

export function parseGraphicsRenderRequest(value: unknown): GraphicsRenderRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!isGraphicsTemplateId(body.template)) return null;
  if (
    typeof body.resourceId !== "number" ||
    !Number.isSafeInteger(body.resourceId) ||
    body.resourceId < 1
  ) {
    return null;
  }
  return { template: body.template, resourceId: body.resourceId };
}

export function graphicsOptionsForTemplate(
  data: GraphicsGeneratorData,
  template: GraphicsTemplateId,
): GraphicsOption[] {
  const source = GRAPHICS_TEMPLATES.find((candidate) => candidate.id === template)?.source;
  if (source === "matches") return data.matches;
  if (source === "standings") return data.standings;
  return data.news;
}

export function initialGraphicsSelection(
  data: GraphicsGeneratorData,
  template: GraphicsTemplateId,
): number | null {
  return graphicsOptionsForTemplate(data, template)[0]?.id ?? null;
}
