import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/metadata";
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
  "/predictions",
  "/terms",
  "/privacy",
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: absoluteUrl(path),
    changeFrequency: path === "/" ? "daily" : "weekly",
    priority: path === "/" ? 1 : 0.6,
  }));

  try {
    const [games, media, tournaments, news] = await Promise.all([
      listGamesCached(),
      listMediaChannelsCached(),
      listTournamentSummariesCached(),
      listLatestPublishedNewsPostsCached("en", 50),
    ]);
    for (const game of games) {
      entries.push({ url: absoluteUrl(`/games/${game.slug}`), changeFrequency: "daily", priority: 0.7 });
    }
    for (const channel of media) {
      entries.push({ url: absoluteUrl(`/media/${channel.slug}`), changeFrequency: "weekly", priority: 0.5 });
    }
    for (const t of tournaments) {
      entries.push({ url: absoluteUrl(`/tournaments/${t.id}`), changeFrequency: "hourly", priority: 0.6 });
    }
    for (const post of news) {
      entries.push({
        url: absoluteUrl(`/games/${post.gameSlug}/news/${post.id}`),
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }
  } catch {
    // DB unavailable — still serve the static routes.
  }
  return entries;
}
