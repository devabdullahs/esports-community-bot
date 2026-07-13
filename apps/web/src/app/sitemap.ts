import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/metadata";
import { dateTimeIso, localizedPath, type Locale } from "@/lib/i18n";
import { listGamesCached } from "@/lib/games";
import { listMediaChannelsCached } from "@/lib/media";
import { listPublishedNewsPostsForDiscoveryCached } from "@/lib/news";
import { newsAvailableLocales, newsLanguagePaths, newsPublicPath } from "@/lib/news-url";
import {
  listIndexableLeaderboards,
  listIndexableMatches,
  listIndexablePlayers,
  listIndexableTeams,
  listIndexableTournaments,
} from "@/lib/seo-index";

export const runtime = "nodejs";
// Generated per request from current CMS data; the DB read is the cached helper.
export const dynamic = "force-dynamic";

const STATIC_PATHS = [
  "/",
  "/games",
  "/news",
  "/news/ewc",
  "/media",
  "/co-streams",
  "/tournaments",
  "/tournaments/ewc",
  "/tournaments/archive",
  "/teams",
  "/players",
  "/clubs",
  "/clubs/standings",
  "/predictions",
  "/docs/mcp",
  "/docs/admin-mcp",
  "/partners",
  "/terms",
  "/privacy",
];

function localizedEntries(
  path: string,
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"],
  priority: number,
  lastModified?: string,
): MetadataRoute.Sitemap {
  const en = absoluteUrl(path);
  const ar = absoluteUrl(localizedPath(path, "ar"));
  const alternates = {
    languages: {
      en,
      ar,
      "x-default": en,
    },
  };
  return [
    { url: en, changeFrequency, priority, alternates, ...(lastModified ? { lastModified } : {}) },
    { url: ar, changeFrequency, priority, alternates, ...(lastModified ? { lastModified } : {}) },
  ];
}

function safeLastModified(value: string | null | undefined) {
  return value ? dateTimeIso(value) : undefined;
}

function newsEntries(post: Awaited<ReturnType<typeof listPublishedNewsPostsForDiscoveryCached>>[number]) {
  const languagePaths = newsLanguagePaths(post);
  const alternates = {
    languages: Object.fromEntries(
      Object.entries(languagePaths).map(([locale, path]) => [locale, absoluteUrl(path)]),
    ),
  };
  const lastModified = safeLastModified(post.updatedAt || post.publishedAt || post.createdAt);
  return newsAvailableLocales(post).map((locale: Locale) => ({
    url: absoluteUrl(newsPublicPath(post, locale)),
    changeFrequency: "weekly" as const,
    priority: 0.7,
    alternates,
    ...(lastModified ? { lastModified } : {}),
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = STATIC_PATHS.flatMap((path) =>
    localizedEntries(path, path === "/" ? "daily" : "weekly", path === "/" ? 1 : 0.6),
  );

  try {
    const [games, media, tournaments, news, teams, players, matches, leaderboards] = await Promise.all([
      listGamesCached(),
      listMediaChannelsCached(),
      listIndexableTournaments(),
      listPublishedNewsPostsForDiscoveryCached(),
      listIndexableTeams(),
      listIndexablePlayers(),
      listIndexableMatches(),
      listIndexableLeaderboards(),
    ]);
    for (const game of games) {
      entries.push(...localizedEntries(
        `/games/${game.slug}`,
        "daily",
        0.7,
        safeLastModified(game.updatedAt || game.createdAt),
      ));
    }
    for (const channel of media) {
      entries.push(...localizedEntries(
        `/media/${channel.slug}`,
        "weekly",
        0.5,
        safeLastModified(channel.updatedAt || channel.createdAt),
      ));
    }
    for (const t of tournaments) {
      entries.push(...localizedEntries(
        `/tournaments/${t.id}`,
        "hourly",
        0.7,
        safeLastModified(t.updatedAt),
      ));
    }
    for (const post of news) {
      entries.push(...newsEntries(post));
    }
    for (const team of teams) {
      entries.push(...localizedEntries(`/teams/${team.id}`, "weekly", 0.5, safeLastModified(team.updatedAt)));
    }
    for (const player of players) {
      entries.push(...localizedEntries(`/players/${player.id}`, "weekly", 0.5, safeLastModified(player.updatedAt)));
    }
    for (const match of matches) {
      entries.push(...localizedEntries(`/matches/${match.id}`, "daily", 0.5, safeLastModified(match.updatedAt)));
    }
    for (const board of leaderboards) {
      entries.push(...localizedEntries(
        `/leaderboard/${encodeURIComponent(board.guildId)}/${encodeURIComponent(board.season)}`,
        "daily",
        0.6,
        safeLastModified(board.updatedAt),
      ));
    }
  } catch {
    // DB unavailable — still serve the static routes.
  }
  return entries;
}
