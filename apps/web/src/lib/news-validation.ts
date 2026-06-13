import { isSafeUrl } from "@/lib/safe-url";
import {
  isNewsCoverPlacement,
  NEWS_BODY_MAX_LENGTH,
  NEWS_SUMMARY_MAX_LENGTH,
  NEWS_TITLE_MAX_LENGTH,
  validateNewsContentInput,
} from "@bot/lib/ewcNewsContent.js";
import type { NewsCoverPlacement, NewsPostInput } from "@/lib/news";

export { NEWS_BODY_MAX_LENGTH, NEWS_SUMMARY_MAX_LENGTH, NEWS_TITLE_MAX_LENGTH };

export type ValidatedNewsInput = NewsPostInput & {
  gameSlug: string;
  coverImageUrl: string | null;
  coverPlacement: NewsCoverPlacement;
};

type NewsContentValidationResult =
  | {
      ok: true;
      value: Pick<
        NewsPostInput,
        "contentMode" | "defaultLocale" | "status" | "translations"
      >;
    }
  | { ok: false; error: string };

export function validateNewsInput(
  raw: unknown,
): { ok: true; value: ValidatedNewsInput } | { ok: false; error: string } {
  const body = (raw ?? {}) as Record<string, unknown>;

  const gameSlug = typeof body.gameSlug === "string" ? body.gameSlug.trim() : "";
  if (!gameSlug) return { ok: false, error: "Game is required" };

  const content = validateNewsContentInput(body) as NewsContentValidationResult;
  if (!content.ok) return { ok: false, error: content.error };

  let coverImageUrl: string | null = null;
  const rawCover = body.coverImageUrl;
  if (typeof rawCover === "string" && rawCover.trim() !== "") {
    if (rawCover.trim().length > 512) {
      return { ok: false, error: "Cover image URL must be 512 characters or fewer" };
    }
    if (!isSafeUrl(rawCover)) {
      return { ok: false, error: "Cover image must be a valid http(s) URL" };
    }
    coverImageUrl = rawCover.trim();
  }

  // Cover placement is optional; absent/blank falls back to the default ('top').
  // An explicit but unrecognized value is rejected so we never persist junk.
  let coverPlacement: NewsCoverPlacement = "top";
  const rawPlacement = body.coverPlacement;
  if (rawPlacement !== undefined && rawPlacement !== null) {
    if (!isNewsCoverPlacement(rawPlacement)) {
      return { ok: false, error: "Cover placement must be top, bottom, or card-only" };
    }
    // The JS guard above narrows at runtime; assert the type for TS (plain-JS import).
    coverPlacement = rawPlacement as NewsCoverPlacement;
  }

  return {
    ok: true,
    value: {
      gameSlug,
      ...content.value,
      coverImageUrl,
      coverPlacement,
    },
  };
}

export function parsePostId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}
