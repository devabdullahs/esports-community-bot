import { isSafeUrl } from "@/lib/safe-url";
import { normalizeSlug } from "@/lib/game-validation";
import type { Locale } from "@/lib/i18n";

export { normalizeSlug };

export const MEDIA_NAME_MAX_LENGTH = 120;
export const MEDIA_TEXT_MAX_LENGTH = 600;
export const MEDIA_URL_MAX_LENGTH = 512;
export const MEDIA_LINKS_MAX_ITEMS = 12;

export const MEDIA_PLATFORMS = [
  "x",
  "youtube",
  "tiktok",
  "instagram",
  "twitch",
  "website",
] as const;
export type MediaPlatform = (typeof MEDIA_PLATFORMS)[number];
const PLATFORM_SET = new Set<string>(MEDIA_PLATFORMS);

export type LocalizedText = Record<Locale, string>;
export type MediaLink = { platform: MediaPlatform; url: string };

function localized(raw: unknown): LocalizedText {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    en: typeof obj.en === "string" ? obj.en.trim() : "",
    ar: typeof obj.ar === "string" ? obj.ar.trim() : "",
  };
}

export function parseMediaLinks(raw: unknown): MediaLink[] {
  if (!Array.isArray(raw)) return [];
  const links: MediaLink[] = [];
  for (const item of raw) {
    const obj = (item ?? {}) as Record<string, unknown>;
    const platform = typeof obj.platform === "string" ? obj.platform : "";
    const url = typeof obj.url === "string" ? obj.url.trim() : "";
    if (!PLATFORM_SET.has(platform) || !url) continue;
    if (url.length > MEDIA_URL_MAX_LENGTH) continue;
    if (!isSafeUrl(url)) continue;
    links.push({ platform: platform as MediaPlatform, url });
  }
  return links.slice(0, MEDIA_LINKS_MAX_ITEMS);
}

export type ValidatedMediaContent = {
  name: LocalizedText;
  description: LocalizedText;
  logoUrl: string | null;
  links: MediaLink[];
};

export function validateMediaContent(
  raw: unknown,
): { ok: true; value: ValidatedMediaContent } | { ok: false; error: string } {
  const body = (raw ?? {}) as Record<string, unknown>;

  const name = localized(body.name);
  if (!name.en || !name.ar) {
    return { ok: false, error: "Name is required in English and Arabic" };
  }
  if (name.en.length > MEDIA_NAME_MAX_LENGTH) {
    return { ok: false, error: `Name must be ${MEDIA_NAME_MAX_LENGTH} characters or fewer` };
  }
  if (name.ar.length > MEDIA_NAME_MAX_LENGTH) {
    return { ok: false, error: `Name must be ${MEDIA_NAME_MAX_LENGTH} characters or fewer` };
  }

  const description = localized(body.description);
  if (description.en.length > MEDIA_TEXT_MAX_LENGTH) {
    return { ok: false, error: `Description must be ${MEDIA_TEXT_MAX_LENGTH} characters or fewer` };
  }
  if (description.ar.length > MEDIA_TEXT_MAX_LENGTH) {
    return { ok: false, error: `Description must be ${MEDIA_TEXT_MAX_LENGTH} characters or fewer` };
  }

  let logoUrl: string | null = null;
  const rawLogo = body.logoUrl;
  if (typeof rawLogo === "string" && rawLogo.trim() !== "") {
    const trimmedLogo = rawLogo.trim();
    if (trimmedLogo.length > MEDIA_URL_MAX_LENGTH) {
      return { ok: false, error: `Logo URL must be ${MEDIA_URL_MAX_LENGTH} characters or fewer` };
    }
    if (!isSafeUrl(rawLogo)) return { ok: false, error: "Logo must be a valid http(s) URL" };
    logoUrl = trimmedLogo;
  }

  const links = parseMediaLinks(body.links);

  return { ok: true, value: { name, description, logoUrl, links } };
}
