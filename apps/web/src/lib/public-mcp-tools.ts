import "server-only";

import { all } from "@bot/db/client.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAllCoStreamsCached, type CoStream } from "@/lib/co-streams";
import {
  cleanDirectoryQuery,
  cleanGameSlug,
  listPlayersDirectory,
  listTeamsDirectory,
} from "@/lib/entity-directory";
import {
  filterEwcClubTracker,
  getEwcClubTrackerForMcp,
  type EwcClubTrackerClub,
} from "@/lib/ewc-clubs";
import { CLUB_REGION_IDS } from "@/lib/ewc-club-regions";
import { currentSeason } from "@/lib/env";
import { listGamesCached, type GameRecord } from "@/lib/games";
import type { Locale } from "@/lib/i18n";
import {
  listLatestPublishedNewsPostsCached,
  listPublishedMediaPostsCached,
  listPublishedNewsPostsCached,
  type NewsPost,
} from "@/lib/news";
import type { PlayerProfile, TeamProfile } from "@/lib/pandascore-profiles";
import { getPublicEwcLeaderboardCached } from "@/lib/public-ewc-leaderboard";
import { resolveDefaultGuildId } from "@/lib/guild";
import {
  getTournamentMatchesCached,
  listTournamentSummariesCached,
  type TournamentSummary,
} from "@/lib/tournaments";
import { isSeason, isSnowflake } from "@/lib/validate";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export const PUBLIC_MCP_TOOL_NAMES = [
  "get_site_overview",
  "list_games",
  "search_news",
  "get_tournament_status",
  "list_tournaments",
  "get_ewc_club_summary",
  "list_co_streams",
  "search_teams",
  "search_players",
  "get_public_ewc_leaderboard",
] as const;

export const PUBLIC_ONLY_MCP_TOOL_NAMES = [
  "list_games",
  "list_tournaments",
  "list_co_streams",
  "search_teams",
  "search_players",
  "get_public_ewc_leaderboard",
] as const;

const LocaleSchema = z.enum(["en", "ar"]).optional();

function jsonResult(data: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function localized(value: GameRecord["title"], locale: Locale) {
  return value[locale] || value.en || value.ar || "";
}

function publicGame(game: GameRecord, locale: Locale) {
  return {
    slug: game.slug,
    title: localized(game.title, locale),
    description: localized(game.description, locale),
    status: localized(game.status, locale),
    owner: localized(game.owner, locale),
    focus: game.focus.map((item) => localized(item, locale)).filter(Boolean),
    sortOrder: game.sortOrder,
  };
}

function newsUrl(post: NewsPost) {
  if (post.mediaSlug) return `/media/${post.mediaSlug}/news/${post.id}`;
  return post.gameSlug ? `/games/${post.gameSlug}/news/${post.id}` : `/news/${post.id}`;
}

function publicNewsPost(post: NewsPost) {
  return {
    id: post.id,
    url: newsUrl(post),
    title: post.title,
    summary: post.summary,
    bodyPreview: post.body.slice(0, 1_500),
    locale: post.locale,
    gameSlug: post.gameSlug,
    mediaSlug: post.mediaSlug,
    coverImageUrl: post.coverImageUrl,
    coverPlacement: post.coverPlacement,
    ewc: post.ewc,
    authors: post.authors.map((author) => ({
      name: author.name,
      avatarUrl: author.avatarUrl,
    })),
    publishedAt: post.publishedAt,
    updatedAt: post.updatedAt,
  };
}

function safeTeam(team: TeamProfile) {
  return {
    id: team.id,
    game: team.game,
    name: team.name,
    slug: team.slug,
    acronym: team.acronym,
    nationality: team.nationality,
    location: team.location,
    imageUrl: team.image_url,
    liquipediaUrl: team.liquipedia_url,
    lastSeenAt: team.last_seen_at,
    updatedAt: team.updated_at,
  };
}

function safePlayer(player: PlayerProfile) {
  return {
    id: player.id,
    game: player.game,
    name: player.name,
    slug: player.slug,
    firstName: player.first_name,
    lastName: player.last_name,
    nationality: player.nationality,
    imageUrl: player.image_url,
    role: player.role,
    currentTeamName: player.current_team_name,
    resolvedTeam: player.resolved_team_id
      ? {
          id: player.resolved_team_id,
          name: player.resolved_team_name,
          slug: player.resolved_team_slug,
          imageUrl: player.resolved_team_image_url,
        }
      : null,
    liquipediaUrl: player.liquipedia_url,
    lastSeenAt: player.last_seen_at,
    updatedAt: player.updated_at,
  };
}

function publicClub(club: EwcClubTrackerClub) {
  return {
    name: club.name,
    pageUrl: club.pageUrl,
    logo: club.logo,
    region: club.region,
    regionSource: club.regionSource,
    locationLabel: club.locationLabel,
    featured: club.featured,
    supportProgram: club.supportProgram,
    rank: club.rank,
    points: club.points,
    eligibility: club.eligibility,
    qualifiedCount: club.qualifiedCount,
    possibleEvents: club.possibleEvents,
    totalTeams: club.totalTeams,
    qualifiedGames: club.qualifiedGames.map((game) => ({
      label: game.label,
      shortLabel: game.shortLabel,
      pageUrl: game.pageUrl,
      status: game.status,
    })),
    possibleGames: club.possibleGames.map((game) => ({
      label: game.label,
      shortLabel: game.shortLabel,
      pageUrl: game.pageUrl,
      status: game.status,
    })),
    wins: club.wins,
  };
}

function publicCoStream(stream: CoStream) {
  return {
    id: stream.id,
    label: stream.label,
    creatorKey: stream.creatorKey,
    gameSlugs: stream.gameSlugs,
    language: stream.language,
    isLive: stream.isLive,
    liveTitle: stream.liveTitle,
    liveGame: stream.liveGame,
    viewerCount: stream.viewerCount,
    startedAt: stream.startedAt,
    embedChannel: stream.embedChannel
      ? {
          platform: stream.embedChannel.platform,
          handle: stream.embedChannel.handle,
          url: stream.embedChannel.url,
          videoId: stream.embedChannel.videoId,
        }
      : null,
    channels: stream.channels.map((channel) => ({
      platform: channel.platform,
      handle: channel.handle,
      label: channel.label,
      scope: channel.scope,
      gameSlugs: channel.gameSlugs,
      language: channel.language,
      isDefault: channel.isDefault,
      isLive: channel.isLive,
      liveTitle: channel.liveTitle,
      liveGame: channel.liveGame,
      viewerCount: channel.viewerCount,
      startedAt: channel.startedAt,
      url: channel.url,
      videoId: channel.videoId,
    })),
  };
}

function tournamentStatus(summary: TournamentSummary) {
  if (summary.matchCounts.running > 0) return "live";
  if (summary.matchCounts.scheduled > 0) return "upcoming";
  return "finished";
}

async function publishedNewsCount() {
  const rows = (await all(
    "SELECT COUNT(*) AS count FROM ewc_news_posts WHERE status = 'published'",
    [],
  )) as Array<{ count: number }>;
  return Number(rows[0]?.count ?? 0);
}

async function getDefaultLeaderboardGuildId(guildId?: string) {
  if (guildId) return guildId;
  return resolveDefaultGuildId();
}

export function createPublicMcpServer() {
  const server = new McpServer({
    name: "esports-community-public",
    version: "0.1.0",
  });

  registerPublicMcpTools(server);
  return server;
}

export function registerPublicMcpTools(
  server: McpServer,
  options: { exclude?: Iterable<string> } = {},
) {
  const excluded = new Set(options.exclude ?? []);

  if (!excluded.has("get_site_overview")) server.registerTool(
    "get_site_overview",
    {
      title: "Get Public Site Overview",
      description: "Return public counts for games, tournaments, matches, news, and co-streams.",
    },
    async () => {
      const [games, tournaments, streams, newsCount] = await Promise.all([
        listGamesCached(),
        listTournamentSummariesCached(),
        getAllCoStreamsCached(),
        publishedNewsCount(),
      ]);

      return jsonResult({
        games: games.length,
        activeTournaments: tournaments.length,
        liveMatches: tournaments.reduce((sum, t) => sum + t.matchCounts.running, 0),
        upcomingMatches: tournaments.reduce((sum, t) => sum + t.matchCounts.scheduled, 0),
        publishedNews: newsCount,
        liveCoStreams: streams.filter((stream) => stream.isLive).length,
      });
    },
  );

  if (!excluded.has("list_games")) server.registerTool(
    "list_games",
    {
      title: "List Games",
      description: "List the localized public game directory.",
      inputSchema: { locale: LocaleSchema },
    },
    async ({ locale = "en" }) => {
      const games = (await listGamesCached()).map((game) => publicGame(game, locale));
      return jsonResult({ games });
    },
  );

  if (!excluded.has("search_news")) server.registerTool(
    "search_news",
    {
      title: "Search Published News",
      description: "Search published public news only. Drafts are never returned.",
      inputSchema: {
        query: z.string().max(120).optional(),
        locale: LocaleSchema,
        gameSlug: z.string().max(40).optional(),
        mediaSlug: z.string().max(80).optional(),
        ewcOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(25).optional(),
      },
    },
    async ({ query = "", locale = "en", gameSlug = "", mediaSlug = "", ewcOnly = false, limit = 10 }) => {
      const cleanGame = cleanGameSlug(gameSlug);
      const cleanMedia = String(mediaSlug || "").trim().toLowerCase().slice(0, 80);
      const fetchLimit = clampInt(limit, 1, 25, 10);
      const haystack = query.trim().toLowerCase();
      let posts: NewsPost[];

      if (cleanMedia) {
        posts = await listPublishedMediaPostsCached(cleanMedia, locale, 100);
      } else if (cleanGame) {
        posts = await listPublishedNewsPostsCached(cleanGame, locale);
      } else {
        posts = await listLatestPublishedNewsPostsCached(locale, 51, ewcOnly, 0);
      }

      const filtered = posts
        .filter((post) => !ewcOnly || post.ewc)
        .filter((post) => {
          if (!haystack) return true;
          return [post.title, post.summary, post.body]
            .some((value) => value.toLowerCase().includes(haystack));
        })
        .slice(0, fetchLimit)
        .map(publicNewsPost);

      return jsonResult({ posts: filtered });
    },
  );

  if (!excluded.has("get_tournament_status")) server.registerTool(
    "get_tournament_status",
    {
      title: "Get Tournament Status",
      description: "Return the public tournament matches and standings projection.",
      inputSchema: {
        tournamentId: z.number().int().positive(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    async ({ tournamentId, limit = 50, offset = 0 }) => {
      const data = await getTournamentMatchesCached(tournamentId, { limit, offset });
      if (!data) return errorResult("Tournament not found.");
      return jsonResult(data as unknown as Record<string, unknown>);
    },
  );

  if (!excluded.has("list_tournaments")) server.registerTool(
    "list_tournaments",
    {
      title: "List Tournaments",
      description: "List public active tournament summaries.",
      inputSchema: {
        gameSlug: z.string().max(40).optional(),
        ewcOnly: z.boolean().optional(),
        status: z.enum(["any", "live", "upcoming", "finished"]).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ gameSlug = "", ewcOnly = false, status = "any", limit = 25 }) => {
      const cleanGame = cleanGameSlug(gameSlug);
      const tournaments = (await listTournamentSummariesCached())
        .filter((t) => !cleanGame || t.game === cleanGame)
        .filter((t) => !ewcOnly || t.ewc)
        .filter((t) => status === "any" || tournamentStatus(t) === status)
        .slice(0, clampInt(limit, 1, 100, 25))
        .map((t) => ({
          id: t.id,
          name: t.name,
          game: t.game,
          source: t.source,
          url: t.url,
          ewc: t.ewc,
          status: tournamentStatus(t),
          matchCounts: t.matchCounts,
          hasStandings: t.hasStandings,
          featuredMatch: t.featuredMatch,
          lastMatchAt: t.last_match_at,
          createdAt: t.created_at,
        }));
      return jsonResult({ tournaments });
    },
  );

  if (!excluded.has("get_ewc_club_summary")) server.registerTool(
    "get_ewc_club_summary",
    {
      title: "Get EWC Club Summary",
      description: "Return public EWC club points, qualified games, wins, and region metadata.",
      inputSchema: {
        query: z.string().max(120).optional(),
        region: z.enum(CLUB_REGION_IDS).optional(),
        scope: z.enum(["featured", "all"]).optional(),
        limit: z.number().int().min(1).max(60).optional(),
      },
    },
    async ({ query = "", region = "all", scope = "featured", limit = 20 }) => {
      const tracker = await getEwcClubTrackerForMcp(8_000);
      const clubs = filterEwcClubTracker(tracker, {
        region,
        q: query,
        scope,
      })
        .slice(0, clampInt(limit, 1, 60, 20))
        .map(publicClub);

      return jsonResult({
        sourceUrl: tracker.sourceUrl,
        standingsSourceUrl: tracker.standingsSourceUrl,
        updatedAt: tracker.updatedAt,
        dataSource: tracker.dataSource ?? "liquipedia",
        warning: tracker.warning ?? null,
        summary: tracker.summary,
        clubs,
      });
    },
  );

  if (!excluded.has("list_co_streams")) server.registerTool(
    "list_co_streams",
    {
      title: "List Co-streams",
      description: "List public co-stream groups, live-first.",
      inputSchema: {
        liveOnly: z.boolean().optional(),
        gameSlug: z.string().max(40).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ liveOnly = false, gameSlug = "", limit = 50 }) => {
      const cleanGame = cleanGameSlug(gameSlug);
      const streams = (await getAllCoStreamsCached())
        .filter((stream) => !liveOnly || stream.isLive)
        .filter((stream) => !cleanGame || stream.gameSlugs.includes(cleanGame))
        .slice(0, clampInt(limit, 1, 100, 50))
        .map(publicCoStream);
      return jsonResult({ streams });
    },
  );

  if (!excluded.has("search_teams")) server.registerTool(
    "search_teams",
    {
      title: "Search Teams",
      description: "Search the public team directory with safe public fields.",
      inputSchema: {
        query: z.string().max(80).optional(),
        gameSlug: z.string().max(40).optional(),
        limit: z.number().int().min(1).max(50).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    async ({ query = "", gameSlug = "", limit = 20, offset = 0 }) => {
      const result = await listTeamsDirectory({
        game: cleanGameSlug(gameSlug) || null,
        q: cleanDirectoryQuery(query) || null,
        limit: clampInt(limit, 1, 50, 20),
        offset: clampInt(offset, 0, 100_000, 0),
      });
      return jsonResult({ total: result.total, teams: result.teams.map(safeTeam) });
    },
  );

  if (!excluded.has("search_players")) server.registerTool(
    "search_players",
    {
      title: "Search Players",
      description: "Search the public player directory with safe public fields.",
      inputSchema: {
        query: z.string().max(80).optional(),
        gameSlug: z.string().max(40).optional(),
        limit: z.number().int().min(1).max(50).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    async ({ query = "", gameSlug = "", limit = 20, offset = 0 }) => {
      const result = await listPlayersDirectory({
        game: cleanGameSlug(gameSlug) || null,
        q: cleanDirectoryQuery(query) || null,
        limit: clampInt(limit, 1, 50, 20),
        offset: clampInt(offset, 0, 100_000, 0),
      });
      return jsonResult({ total: result.total, players: result.players.map(safePlayer) });
    },
  );

  if (!excluded.has("get_public_ewc_leaderboard")) server.registerTool(
    "get_public_ewc_leaderboard",
    {
      title: "Get Public EWC Leaderboard",
      description: "Return the existing public EWC leaderboard projection.",
      inputSchema: {
        guildId: z.string().optional(),
        season: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    async ({ guildId = "", season = currentSeason(), limit = 50, offset = 0 }) => {
      const resolvedGuildId = await getDefaultLeaderboardGuildId(guildId.trim() || undefined);
      if (!resolvedGuildId || !isSnowflake(resolvedGuildId)) {
        return errorResult("No public leaderboard guild is configured.");
      }
      if (!isSeason(season)) return errorResult("Season must be a four-digit year.");

      const leaderboard = await getPublicEwcLeaderboardCached({
        guildId: resolvedGuildId,
        season,
        limit,
        offset,
      });
      return jsonResult(leaderboard as unknown as Record<string, unknown>);
    },
  );

  return server;
}
