import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/metadata";
import { localizedPath } from "@/lib/i18n";
import { listGamesCached } from "@/lib/games";
import { listMediaChannelsCached } from "@/lib/media";
import { listTournamentSummariesCached } from "@/lib/tournaments";
import { listLatestPublishedNewsPostsCached } from "@/lib/news";

export const runtime = "nodejs";
// Generated per request from current CMS data; the DB read is the cached helper.
export const dynamic = "force-dynamic";

const STATIC_PATHS = [
  "/",
  "/games",
  "/news",
  "/news/ewc",
  "/media",
  "/tournaments",
  "/tournaments/ewc",
  "/clubs",
  "/clubs/standings",
  "/predictions",
  "/docs/mcp",
  "/docs/admin-mcp",
  "/terms",
  "/privacy",
];

function localizedEntries(
  path: string,
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"],
  priority: number,
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
    { url: en, changeFrequency, priority, alternates },
    { url: ar, changeFrequency, priority, alternates },
  ];
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = STATIC_PATHS.flatMap((path) =>
    localizedEntries(path, path === "/" ? "daily" : "weekly", path === "/" ? 1 : 0.6),
  );

  try {
    const [games, media, tournaments, news] = await Promise.all([
      listGamesCached(),
      listMediaChannelsCached(),
      listTournamentSummariesCached(),
      listLatestPublishedNewsPostsCached("en", 50),
    ]);
    for (const game of games) {
      entries.push(...localizedEntries(`/games/${game.slug}`, "daily", 0.7));
    }
    for (const channel of media) {
      entries.push(...localizedEntries(`/media/${channel.slug}`, "weekly", 0.5));
    }
    for (const t of tournaments) {
      entries.push(...localizedEntries(`/tournaments/${t.id}`, "hourly", 0.6));
    }
    for (const post of news) {
      entries.push(...localizedEntries(`/games/${post.gameSlug}/news/${post.id}`, "weekly", 0.6));
    }
  } catch {
    // DB unavailable — still serve the static routes.
  }
  return entries;
}
