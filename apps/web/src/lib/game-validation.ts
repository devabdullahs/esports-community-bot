import type { Locale } from "@/lib/i18n";

// Client-safe (no DB / server-only imports) so both the editor and the API routes use it.
export type LocalizedText = Record<Locale, string>;

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

export function validateGameContent(
  raw: unknown,
): { ok: true; value: ValidatedGameContent } | { ok: false; error: string } {
  const body = (raw ?? {}) as Record<string, unknown>;

  const title = localized(body.title);
  if (!title.en || !title.ar) {
    return { ok: false, error: "Title is required in English and Arabic" };
  }

  const description = localized(body.description);
  const status = localized(body.status);
  const owner = localized(body.owner);

  const focusRaw = Array.isArray(body.focus) ? body.focus : [];
  const focus = focusRaw.map(localized).filter((item) => item.en || item.ar);

  return { ok: true, value: { title, description, status, owner, focus } };
}
