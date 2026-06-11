import type { Locale } from "@/lib/i18n";

// Client-safe (no DB / server-only imports) so both the editor and the API routes use it.
export type LocalizedText = Record<Locale, string>;

export const GAME_TITLE_MAX_LENGTH = 120;
export const GAME_TEXT_MAX_LENGTH = 600;
export const GAME_FOCUS_ITEM_MAX_LENGTH = 120;
export const GAME_FOCUS_MAX_ITEMS = 12;

/** Normalize a string into a URL-safe slug (lowercase, hyphenated, <=60 chars). */
export function normalizeSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function localized(raw: unknown): LocalizedText {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    en: typeof obj.en === "string" ? obj.en.trim() : "",
    ar: typeof obj.ar === "string" ? obj.ar.trim() : "",
  };
}

export type ValidatedGameContent = {
  title: LocalizedText;
  description: LocalizedText;
  status: LocalizedText;
  owner: LocalizedText;
  focus: LocalizedText[];
};

export type GameValidationCode =
  | "title-required"
  | "title-too-long"
  | "description-too-long"
  | "status-too-long"
  | "owner-too-long"
  | "focus-too-many"
  | "focus-item-too-long";

export function validateGameContent(
  raw: unknown,
): { ok: true; value: ValidatedGameContent } | { ok: false; error: string; code: GameValidationCode } {
  const body = (raw ?? {}) as Record<string, unknown>;

  const title = localized(body.title);
  if (!title.en || !title.ar) {
    return { ok: false, error: "Title is required in English and Arabic", code: "title-required" };
  }
  if (title.en.length > GAME_TITLE_MAX_LENGTH) {
    return { ok: false, error: `Title must be ${GAME_TITLE_MAX_LENGTH} characters or fewer`, code: "title-too-long" };
  }
  if (title.ar.length > GAME_TITLE_MAX_LENGTH) {
    return { ok: false, error: `Title must be ${GAME_TITLE_MAX_LENGTH} characters or fewer`, code: "title-too-long" };
  }

  const description = localized(body.description);
  if (description.en.length > GAME_TEXT_MAX_LENGTH) {
    return { ok: false, error: `Description must be ${GAME_TEXT_MAX_LENGTH} characters or fewer`, code: "description-too-long" };
  }
  if (description.ar.length > GAME_TEXT_MAX_LENGTH) {
    return { ok: false, error: `Description must be ${GAME_TEXT_MAX_LENGTH} characters or fewer`, code: "description-too-long" };
  }

  const status = localized(body.status);
  if (status.en.length > GAME_TEXT_MAX_LENGTH) {
    return { ok: false, error: `Status must be ${GAME_TEXT_MAX_LENGTH} characters or fewer`, code: "status-too-long" };
  }
  if (status.ar.length > GAME_TEXT_MAX_LENGTH) {
    return { ok: false, error: `Status must be ${GAME_TEXT_MAX_LENGTH} characters or fewer`, code: "status-too-long" };
  }

  const owner = localized(body.owner);
  if (owner.en.length > GAME_TEXT_MAX_LENGTH) {
    return { ok: false, error: `Owner must be ${GAME_TEXT_MAX_LENGTH} characters or fewer`, code: "owner-too-long" };
  }
  if (owner.ar.length > GAME_TEXT_MAX_LENGTH) {
    return { ok: false, error: `Owner must be ${GAME_TEXT_MAX_LENGTH} characters or fewer`, code: "owner-too-long" };
  }

  const focusRaw = Array.isArray(body.focus) ? body.focus : [];
  if (focusRaw.length > GAME_FOCUS_MAX_ITEMS) {
    return { ok: false, error: `Focus may have at most ${GAME_FOCUS_MAX_ITEMS} items`, code: "focus-too-many" };
  }
  const focus = focusRaw.map(localized).filter((item) => item.en || item.ar);
  for (const item of focus) {
    if (item.en.length > GAME_FOCUS_ITEM_MAX_LENGTH) {
      return { ok: false, error: `Focus item must be ${GAME_FOCUS_ITEM_MAX_LENGTH} characters or fewer`, code: "focus-item-too-long" };
    }
    if (item.ar.length > GAME_FOCUS_ITEM_MAX_LENGTH) {
      return { ok: false, error: `Focus item must be ${GAME_FOCUS_ITEM_MAX_LENGTH} characters or fewer`, code: "focus-item-too-long" };
    }
  }

  return { ok: true, value: { title, description, status, owner, focus } };
}
