import { canonicalPublicAssetUrl, isSafeUrl } from "@/lib/safe-url";
import { isSnowflake } from "@/lib/validate";
import {
  isNewsCoverPlacement,
  NEWS_BODY_MAX_LENGTH,
  NEWS_SUMMARY_MAX_LENGTH,
  NEWS_TITLE_MAX_LENGTH,
  validateNewsContentInput,
} from "@bot/lib/ewcNewsContent.js";
import type { NewsAuthor, NewsCoverPlacement, NewsPostInput } from "@/lib/news";

export { NEWS_BODY_MAX_LENGTH, NEWS_SUMMARY_MAX_LENGTH, NEWS_TITLE_MAX_LENGTH };

export const NEWS_AUTHOR_NAME_MAX_LENGTH = 120;

export type ValidatedNewsInput = NewsPostInput & {
  gameSlug: string | null;
  mediaSlug: string | null;
  coverImageUrl: string | null;
  coverPlacement: NewsCoverPlacement;
  ewc: boolean;
  authors: NewsAuthor[];
  authorDiscordId: string | null;
  authorName: string | null;
};

export const NEWS_MAX_AUTHORS = 10;

type NewsContentValidationResult =
  | {
      ok: true;
      value: Pick<
        NewsPostInput,
        "contentMode" | "defaultLocale" | "status" | "scheduledPublishAt" | "translations"
      >;
    }
  | { ok: false; error: string };

export function validateNewsInput(
  raw: unknown,
): { ok: true; value: ValidatedNewsInput } | { ok: false; error: string } {
  const body = (raw ?? {}) as Record<string, unknown>;

  // A post is owned by EITHER a media channel (media post) OR a game (game post).
  // For a media post, the game becomes an optional related-game tag.
  const mediaSlug = typeof body.mediaSlug === "string" ? body.mediaSlug.trim() : "";
  const gameSlug = typeof body.gameSlug === "string" ? body.gameSlug.trim() : "";
  if (!mediaSlug && !gameSlug) return { ok: false, error: "Game is required" };

  const content = validateNewsContentInput(body) as NewsContentValidationResult;
  if (!content.ok) return { ok: false, error: content.error };

  let coverImageUrl: string | null = null;
  const rawCover = body.coverImageUrl;
  if (typeof rawCover === "string" && rawCover.trim() !== "") {
    const canonicalCover = canonicalPublicAssetUrl(rawCover);
    if (canonicalCover.length > 512) {
      return { ok: false, error: "Cover image URL must be 512 characters or fewer" };
    }
    if (!isSafeUrl(rawCover)) {
      return { ok: false, error: "Cover image must be a valid http(s) URL" };
    }
    coverImageUrl = canonicalCover;
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

  // Author is optional. authorDiscordId, when present, must be a snowflake; an
  // explicit null clears it. authorName is a free-form display string (≤120).
  let authorDiscordId: string | null = null;
  const rawAuthorId = body.authorDiscordId;
  if (rawAuthorId !== undefined && rawAuthorId !== null && rawAuthorId !== "") {
    if (!isSnowflake(rawAuthorId)) {
      return { ok: false, error: "Author Discord ID must be a 17-20 digit snowflake" };
    }
    authorDiscordId = rawAuthorId;
  }

  let authorName: string | null = null;
  const rawAuthorName = body.authorName;
  if (typeof rawAuthorName === "string" && rawAuthorName.trim() !== "") {
    if (rawAuthorName.trim().length > NEWS_AUTHOR_NAME_MAX_LENGTH) {
      return {
        ok: false,
        error: `Author name must be ${NEWS_AUTHOR_NAME_MAX_LENGTH} characters or fewer`,
      };
    }
    authorName = rawAuthorName.trim();
  }

  // Admin-set EWC tag (boolean). Accepts true / 1 / "true"; anything else is false.
  const ewc = body.ewc === true || body.ewc === 1 || body.ewc === "true";

  // Multiple authors. Each discordId must be a snowflake; name + optional safe
  // avatar URL are snapshotted. Deduped and capped at NEWS_MAX_AUTHORS.
  const authors: NewsAuthor[] = [];
  const seenAuthorIds = new Set<string>();
  const rawAuthors = Array.isArray(body.authors) ? body.authors : [];
  for (const item of rawAuthors) {
    const entry = (item ?? {}) as Record<string, unknown>;
    const discordId = typeof entry.discordId === "string" ? entry.discordId.trim() : "";
    if (!discordId || seenAuthorIds.has(discordId)) continue;
    if (!isSnowflake(discordId)) {
      return { ok: false, error: "Author Discord ID must be a 17-20 digit snowflake" };
    }
    seenAuthorIds.add(discordId);
    const rawName = typeof entry.name === "string" ? entry.name.trim() : "";
    const rawAvatar = typeof entry.avatarUrl === "string" ? entry.avatarUrl.trim() : "";
    authors.push({
      discordId,
      name: rawName.slice(0, NEWS_AUTHOR_NAME_MAX_LENGTH),
      avatarUrl: rawAvatar && isSafeUrl(rawAvatar) ? canonicalPublicAssetUrl(rawAvatar) : null,
    });
    if (authors.length >= NEWS_MAX_AUTHORS) break;
  }

  return {
    ok: true,
    value: {
      gameSlug: gameSlug || null,
      mediaSlug: mediaSlug || null,
      ...content.value,
      coverImageUrl,
      coverPlacement,
      ewc,
      authors,
      authorDiscordId,
      authorName,
    },
  };
}

export function parsePostId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}
