export const GRAPHICS_TEMPLATES = [
  { id: "match-result", label: "Match result", source: "matches" },
  { id: "standings", label: "Standings", source: "standings" },
  { id: "news-promo", label: "News promo", source: "news" },
] as const;

export const GRAPHICS_FORMATS = [
  { id: "16:9", label: "16:9", width: 1920, height: 1080, hint: "Broadcast / YouTube" },
  { id: "1:1", label: "1:1", width: 1080, height: 1080, hint: "Square feed" },
  { id: "9:16", label: "9:16", width: 1080, height: 1920, hint: "Stories / Reels" },
  { id: "4:5", label: "4:5", width: 1080, height: 1350, hint: "Portrait feed" },
] as const;

// Theme metadata mirrors the server renderer palettes (src/lib/adminGraphicsCard.js)
// so the picker cards and canvas overlays preview the real output colors.
export const GRAPHICS_STYLES = [
  {
    id: "ewc-teal", label: "EWC Teal", accent: "#2dd4bf", dark: true,
    gradient: ["#071412", "#0a1a18", "#061110"],
    description: "Signature broadcast look — deep teal field with a glowing accent edge. Default for match results.",
  },
  {
    id: "midnight", label: "Midnight Blue", accent: "#60a5fa", dark: true,
    gradient: ["#080d20", "#0d1530", "#070b1a"],
    description: "Cool navy field with silver-blue type — for international broadcast and partner co-branding.",
  },
  {
    id: "carbon", label: "Carbon", accent: "#e4e4e7", dark: true,
    gradient: ["#0e0e10", "#17171a", "#0c0c0e"],
    description: "Neutral monochrome with no team bias — use when team brand colors clash with the accent.",
  },
  {
    id: "slate", label: "Slate", accent: "#94a3b8", dark: true,
    gradient: ["#141a1e", "#1f272c", "#11171a"],
    description: "Soft blue-grey editorial tone — recaps, standings, and long-form news promos.",
  },
  {
    id: "light", label: "Light", accent: "#0f766e", dark: false,
    gradient: ["#eef1f0", "#ffffff", "#e7ecea"],
    description: "Press and print friendly — white field, deep-teal accents, dark type. For articles and light feeds.",
  },
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

export type GraphicsMediaBrand = {
  slug: string;
  label: string;
  logoUrl: string;
};

export type GraphicsGeneratorData = {
  matches: GraphicsOption[];
  standings: GraphicsOption[];
  news: GraphicsOption[];
  brands: GraphicsMediaBrand[];
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
  brandMediaSlug: string | null;
  brandAssetUrl: string | null;
};

export type CustomMatchGraphicInput = {
  tournament: string;
  game: string;
  teamA: string;
  teamB: string;
  logoA: string | null;
  logoB: string | null;
  scoreMode: "versus" | "score";
  scoreA: number | null;
  scoreB: number | null;
  status: "live" | "finished" | "upcoming";
};

export type CustomStandingsEntry = {
  rank: number;
  team: string;
  logo: string | null;
  points: string;
  extra: string;
};

export type CustomStandingsGraphicInput = {
  tournament: string;
  section: string;
  entries: CustomStandingsEntry[];
};

export type CustomNewsGraphicInput = {
  owner: string;
  title: string;
  summary: string;
};

export type CustomGraphicsInputMap = {
  "match-result": CustomMatchGraphicInput;
  standings: CustomStandingsGraphicInput;
  "news-promo": CustomNewsGraphicInput;
};

export type CustomGraphicsInput =
  | { template: "match-result"; data: CustomMatchGraphicInput }
  | { template: "standings"; data: CustomStandingsGraphicInput }
  | { template: "news-promo"; data: CustomNewsGraphicInput };

export type StoredGraphicsRenderRequest = GraphicsRenderOptions & {
  sourceMode: "stored";
  template: GraphicsTemplateId;
  resourceId: number;
};

export type CustomGraphicsRenderRequest = GraphicsRenderOptions & {
  sourceMode: "custom";
  resourceId: null;
} & CustomGraphicsInput;

export type GraphicsRenderRequest = StoredGraphicsRenderRequest | CustomGraphicsRenderRequest;

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
  brandMediaSlug: null,
  brandAssetUrl: null,
};

export const DEFAULT_CUSTOM_GRAPHICS_INPUTS: CustomGraphicsInputMap = {
  "match-result": {
    tournament: "Tournament name",
    game: "Esports",
    teamA: "Team Alpha",
    teamB: "Team Bravo",
    logoA: null,
    logoB: null,
    scoreMode: "versus",
    scoreA: null,
    scoreB: null,
    status: "upcoming",
  },
  standings: {
    tournament: "Tournament name",
    section: "Final standings",
    entries: [
      { rank: 1, team: "Team Alpha", logo: null, points: "100", extra: "" },
      { rank: 2, team: "Team Bravo", logo: null, points: "82", extra: "" },
      { rank: 3, team: "Team Charlie", logo: null, points: "71", extra: "" },
    ],
  },
  "news-promo": {
    owner: "Community",
    title: "Your headline goes here",
    summary: "Add a concise summary for the announcement.",
  },
};

function includesValue<T>(values: readonly T[], value: unknown): value is T {
  return values.includes(value as T);
}

function boundedNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < min || value > max) return null;
  return Math.round(value * 10) / 10;
}

function boundedText(value: unknown, maxLength: number, required = true): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if ((required && !text) || text.length > maxLength) return null;
  return text;
}

function optionalHttpsUrl(value: unknown): string | null | undefined {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 1024) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function parseCustomInput(template: GraphicsTemplateId, body: Record<string, unknown>): CustomGraphicsInput | null {
  const raw = body.data;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;

  if (template === "match-result") {
    const tournament = boundedText(data.tournament, 260);
    const game = boundedText(data.game, 80);
    const teamA = boundedText(data.teamA, 80);
    const teamB = boundedText(data.teamB, 80);
    const logoA = optionalHttpsUrl(data.logoA);
    const logoB = optionalHttpsUrl(data.logoB);
    const scoreMode = data.scoreMode;
    const status = data.status;
    const scoreA = data.scoreA == null ? null : boundedNumber(data.scoreA, 0, 999);
    const scoreB = data.scoreB == null ? null : boundedNumber(data.scoreB, 0, 999);
    if (!tournament || !game || !teamA || !teamB || logoA === undefined || logoB === undefined) return null;
    if (!includesValue(["versus", "score"] as const, scoreMode)) return null;
    if (!includesValue(["live", "finished", "upcoming"] as const, status)) return null;
    if (scoreMode === "score" && (scoreA === null || scoreB === null)) return null;
    return {
      template,
      data: {
        tournament,
        game,
        teamA,
        teamB,
        logoA,
        logoB,
        scoreMode,
        scoreA: scoreMode === "score" ? scoreA : null,
        scoreB: scoreMode === "score" ? scoreB : null,
        status,
      },
    };
  }

  if (template === "standings") {
    const tournament = boundedText(data.tournament, 260);
    const section = boundedText(data.section, 100);
    if (!tournament || !section || !Array.isArray(data.entries) || data.entries.length < 1 || data.entries.length > 12) return null;
    const entries: CustomStandingsEntry[] = [];
    for (const rawEntry of data.entries) {
      if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) return null;
      const entry = rawEntry as Record<string, unknown>;
      const rank = boundedNumber(entry.rank, 1, 999);
      const team = boundedText(entry.team, 80);
      const logo = optionalHttpsUrl(entry.logo);
      const points = boundedText(entry.points, 32, false);
      const extra = boundedText(entry.extra, 32, false);
      if (rank === null || !team || logo === undefined || points === null || extra === null) return null;
      entries.push({ rank: Math.round(rank), team, logo, points, extra });
    }
    return { template, data: { tournament, section, entries } };
  }

  const owner = boundedText(data.owner, 80);
  const title = boundedText(data.title, 220);
  const summary = boundedText(data.summary, 360, false);
  return owner && title && summary !== null
    ? { template, data: { owner, title, summary } }
    : null;
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
  const sourceMode = body.sourceMode === "custom" ? "custom" : "stored";

  const format = body.format ?? DEFAULT_GRAPHICS_RENDER_OPTIONS.format;
  const language = body.language ?? DEFAULT_GRAPHICS_RENDER_OPTIONS.language;
  const alignment = body.alignment ?? DEFAULT_GRAPHICS_RENDER_OPTIONS.alignment;
  const style = body.style ?? DEFAULT_GRAPHICS_RENDER_OPTIONS.style;
  const scale = body.scale ?? DEFAULT_GRAPHICS_RENDER_OPTIONS.scale;
  const brandPlacement = body.brandPlacement ?? DEFAULT_GRAPHICS_RENDER_OPTIONS.brandPlacement;
  const brandX = boundedNumber(body.brandX ?? DEFAULT_GRAPHICS_RENDER_OPTIONS.brandX, 5, 95);
  const brandY = boundedNumber(body.brandY ?? DEFAULT_GRAPHICS_RENDER_OPTIONS.brandY, 5, 95);
  const brandSize = boundedNumber(body.brandSize ?? DEFAULT_GRAPHICS_RENDER_OPTIONS.brandSize, 5, 24);
  const brandMediaSlug = body.brandMediaSlug == null || body.brandMediaSlug === ""
    ? null
    : typeof body.brandMediaSlug === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/.test(body.brandMediaSlug)
      ? body.brandMediaSlug
      : undefined;
  const brandAssetUrl = body.brandAssetUrl == null || body.brandAssetUrl === ""
    ? null
    : typeof body.brandAssetUrl === "string" && body.brandAssetUrl.length <= 1024
      ? body.brandAssetUrl.trim()
      : undefined;

  if (!isGraphicsFormatId(format)) return null;
  if (!includesValue(GRAPHICS_LANGUAGES, language)) return null;
  if (!includesValue(GRAPHICS_ALIGNMENTS, alignment)) return null;
  if (!isGraphicsStyleId(style)) return null;
  if (!includesValue(GRAPHICS_EXPORT_SCALES, scale)) return null;
  if (!includesValue(GRAPHICS_BRAND_PLACEMENTS, brandPlacement)) return null;
  if (brandX === null || brandY === null || brandSize === null) return null;
  if (brandMediaSlug === undefined) return null;
  if (brandAssetUrl === undefined) return null;
  if (brandAssetUrl) {
    try {
      const url = new URL(brandAssetUrl);
      if (url.protocol !== "https:") return null;
    } catch {
      return null;
    }
  }

  const common = {
    format,
    language,
    alignment,
    style,
    scale,
    brandPlacement,
    brandX,
    brandY,
    brandSize,
    brandMediaSlug,
    brandAssetUrl,
  };

  if (sourceMode === "custom") {
    const custom = parseCustomInput(body.template, body);
    if (!custom) return null;
    return { ...common, sourceMode, resourceId: null, ...custom };
  }

  if (
    typeof body.resourceId !== "number" ||
    !Number.isSafeInteger(body.resourceId) ||
    body.resourceId < 1
  ) {
    return null;
  }
  return { ...common, sourceMode, template: body.template, resourceId: body.resourceId };
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
