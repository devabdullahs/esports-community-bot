export const GRAPHICS_TEMPLATES = [
  { id: "match-result", label: "Match result", source: "matches" },
  { id: "standings", label: "Standings", source: "standings" },
  { id: "news-promo", label: "News promo", source: "news" },
] as const;

export const GRAPHICS_FORMATS = [
  { id: "16:9", label: "16:9", width: 1600, height: 900, hint: "Broadcast / YouTube" },
  { id: "1:1", label: "1:1", width: 1080, height: 1080, hint: "Square feed" },
  { id: "9:16", label: "9:16", width: 1080, height: 1920, hint: "Stories / Reels" },
  { id: "4:5", label: "4:5", width: 1080, height: 1350, hint: "Portrait feed" },
] as const;

export const GRAPHICS_STYLES = [
  { id: "ewc-teal", label: "EWC Teal" },
  { id: "midnight", label: "Midnight Blue" },
  { id: "carbon", label: "Carbon" },
  { id: "slate", label: "Slate" },
  { id: "light", label: "Light" },
] as const;

export const GRAPHICS_LANGUAGES = ["en", "ar", "both"] as const;
export const GRAPHICS_ALIGNMENTS = ["center", "left", "right"] as const;
export const GRAPHICS_EXPORT_SCALES = [1, 2, 3] as const;
export const GRAPHICS_BRAND_PLACEMENTS = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "custom",
] as const;

export type GraphicsTemplateId = (typeof GRAPHICS_TEMPLATES)[number]["id"];
export type GraphicsSourceKind = (typeof GRAPHICS_TEMPLATES)[number]["source"];
export type GraphicsFormatId = (typeof GRAPHICS_FORMATS)[number]["id"];
export type GraphicsStyleId = (typeof GRAPHICS_STYLES)[number]["id"];
export type GraphicsLanguageId = (typeof GRAPHICS_LANGUAGES)[number];
export type GraphicsAlignmentId = (typeof GRAPHICS_ALIGNMENTS)[number];
export type GraphicsExportScale = (typeof GRAPHICS_EXPORT_SCALES)[number];
export type GraphicsBrandPlacement = (typeof GRAPHICS_BRAND_PLACEMENTS)[number];

export type GraphicsOwner =
  | { kind: "game"; slug: string }
  | { kind: "media"; slug: string };

export type GraphicsOption = {
  id: number;
  label: string;
  detail: string;
  owner: GraphicsOwner;
  status?: "live" | "final" | "soon";
  brandLogoUrl?: string | null;
};

export type GraphicsGeneratorData = {
  matches: GraphicsOption[];
  standings: GraphicsOption[];
  news: GraphicsOption[];
};

export type GraphicsRenderOptions = {
  format: GraphicsFormatId;
  language: GraphicsLanguageId;
  alignment: GraphicsAlignmentId;
  style: GraphicsStyleId;
  scale: GraphicsExportScale;
  brandPlacement: GraphicsBrandPlacement;
  brandX: number;
  brandY: number;
  brandSize: number;
};

export type GraphicsRenderRequest = GraphicsRenderOptions & {
  template: GraphicsTemplateId;
  resourceId: number;
};

export const DEFAULT_GRAPHICS_RENDER_OPTIONS: GraphicsRenderOptions = {
  format: "16:9",
  language: "both",
  alignment: "center",
  style: "ewc-teal",
  scale: 2,
  brandPlacement: "top-right",
  brandX: 88,
  brandY: 12,
  brandSize: 12,
};

function includesValue<T>(values: readonly T[], value: unknown): value is T {
  return values.includes(value as T);
}

function boundedNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < min || value > max) return null;
  return Math.round(value * 10) / 10;
}

export function isGraphicsTemplateId(value: unknown): value is GraphicsTemplateId {
  return GRAPHICS_TEMPLATES.some((template) => template.id === value);
}

function isGraphicsFormatId(value: unknown): value is GraphicsFormatId {
  return GRAPHICS_FORMATS.some((format) => format.id === value);
}

function isGraphicsStyleId(value: unknown): value is GraphicsStyleId {
  return GRAPHICS_STYLES.some((style) => style.id === value);
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

  const format = body.format ?? DEFAULT_GRAPHICS_RENDER_OPTIONS.format;
  const language = body.language ?? DEFAULT_GRAPHICS_RENDER_OPTIONS.language;
  const alignment = body.alignment ?? DEFAULT_GRAPHICS_RENDER_OPTIONS.alignment;
  const style = body.style ?? DEFAULT_GRAPHICS_RENDER_OPTIONS.style;
  const scale = body.scale ?? DEFAULT_GRAPHICS_RENDER_OPTIONS.scale;
  const brandPlacement = body.brandPlacement ?? DEFAULT_GRAPHICS_RENDER_OPTIONS.brandPlacement;
  const brandX = boundedNumber(body.brandX ?? DEFAULT_GRAPHICS_RENDER_OPTIONS.brandX, 5, 95);
  const brandY = boundedNumber(body.brandY ?? DEFAULT_GRAPHICS_RENDER_OPTIONS.brandY, 5, 95);
  const brandSize = boundedNumber(body.brandSize ?? DEFAULT_GRAPHICS_RENDER_OPTIONS.brandSize, 5, 24);

  if (!isGraphicsFormatId(format)) return null;
  if (!includesValue(GRAPHICS_LANGUAGES, language)) return null;
  if (!includesValue(GRAPHICS_ALIGNMENTS, alignment)) return null;
  if (!isGraphicsStyleId(style)) return null;
  if (!includesValue(GRAPHICS_EXPORT_SCALES, scale)) return null;
  if (!includesValue(GRAPHICS_BRAND_PLACEMENTS, brandPlacement)) return null;
  if (brandX === null || brandY === null || brandSize === null) return null;

  return {
    template: body.template,
    resourceId: body.resourceId,
    format,
    language,
    alignment,
    style,
    scale,
    brandPlacement,
    brandX,
    brandY,
    brandSize,
  };
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

export function graphicsFormatDimensions(format: GraphicsFormatId) {
  return GRAPHICS_FORMATS.find((candidate) => candidate.id === format) ?? GRAPHICS_FORMATS[0];
}
