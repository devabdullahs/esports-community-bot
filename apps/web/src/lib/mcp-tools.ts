import "server-only";

import { all } from "@bot/db/client.js";
import { recordAdminAudit as recordAudit } from "@bot/db/ewcAdminAuditLog.js";
import { listStandingsForTournament } from "@bot/db/tournamentStandings.js";
import { getTournamentById } from "@bot/db/tournaments.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listReportedModerationComments } from "@/lib/comments";
import { filterEwcClubTracker, getEwcClubTrackerForMcp } from "@/lib/ewc-clubs";
import { CLUB_REGION_IDS } from "@/lib/ewc-club-regions";
import { listGames } from "@/lib/games";
import {
  canMcpManageGame,
  canMcpManageMedia,
  canUseMcpTool,
  mcpAuditActor,
  type McpAccess,
} from "@/lib/mcp-auth";
import { listAdminNewsPosts, createNewsPost } from "@/lib/news";
import { listMediaChannels } from "@/lib/media";
import { registerPublicMcpTools } from "@/lib/public-mcp-tools";
import { getStreamChannel, updateStreamChannel } from "@/lib/stream-channels";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

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

function assertTool(access: McpAccess, tool: string) {
  if (!canUseMcpTool(access, tool)) throw new Error(`This MCP key cannot use ${tool}.`);
}

function postVisibleToAccess(
  access: McpAccess,
  post: { gameSlug?: string | null; mediaSlug?: string | null },
) {
  if (access.isSuper) return true;
  if (post.mediaSlug) return canMcpManageMedia(access, post.mediaSlug);
  if (post.gameSlug) return canMcpManageGame(access, post.gameSlug);
  return false;
}

async function auditMcp(access: McpAccess, action: string, target: string | null, details?: Record<string, unknown>) {
  const actor = mcpAuditActor(access);
  await recordAudit({
    ...actor,
    action,
    target,
    details: {
      ...(details ?? {}),
      keyId: access.key.id,
      keyPrefix: access.key.keyPrefix,
      ownerDiscordId: access.discordUserId,
    },
  });
}

function streamAllowed(access: McpAccess, channel: Awaited<ReturnType<typeof getStreamChannel>>) {
  if (!channel) return false;
  if (access.isSuper) return true;
  if (channel.scope !== "game") return false;
  const slugs = channel.gameSlugs.length ? channel.gameSlugs : channel.gameSlug ? [channel.gameSlug] : [];
  return slugs.length > 0 && slugs.every((slug) => canMcpManageGame(access, slug));
}

function scopedPropagationGameSlugs(access: McpAccess) {
  return access.isSuper || access.games === "ALL" ? undefined : access.games;
}

const ADMIN_PUBLIC_OVERLAP_TOOL_NAMES = [
  "get_site_overview",
  "search_news",
  "get_tournament_status",
  "get_ewc_club_summary",
] as const;

export function createAdminMcpServer(access: McpAccess) {
  const server = new McpServer({
    name: "esports-community-admin",
    version: "0.1.0",
  });

  server.registerTool(
    "get_site_overview",
    {
      title: "Get Site Overview",
      description: "Summarize current dashboard/bot state for admins.",
    },
    async () => {
      assertTool(access, "get_site_overview");
      const games = await listGames();
      const media = await listMediaChannels();
      const counts = await all(
        `SELECT
           (SELECT COUNT(*) FROM tournaments WHERE active = 1 AND archived_at IS NULL) AS active_tournaments,
           (SELECT COUNT(*) FROM matches WHERE status = 'running') AS live_matches,
           (SELECT COUNT(*) FROM matches WHERE status = 'scheduled') AS upcoming_matches,
           (SELECT COUNT(*) FROM ewc_news_posts WHERE status = 'published') AS published_news,
           (SELECT COUNT(*) FROM ewc_news_posts WHERE status = 'draft') AS draft_news,
           (SELECT COUNT(*) FROM stream_channels WHERE active = 1) AS active_stream_channels,
           (SELECT COUNT(*) FROM comment_reports WHERE status = 'open') AS open_reports`,
          [],
      );
      const row = (counts[0] ?? {}) as Record<string, unknown>;
      const data: Record<string, unknown> = {
        games: games.length,
        mediaChannels: media.length,
        ...row,
        activeTournaments: Number(row.active_tournaments ?? 0),
        liveMatches: Number(row.live_matches ?? 0),
        upcomingMatches: Number(row.upcoming_matches ?? 0),
        publishedNews: Number(row.published_news ?? 0),
        activeStreamChannels: Number(row.active_stream_channels ?? 0),
      };
      if (access.isSuper) {
        data.recentAudit = await all(
          `SELECT action, target, actor_name, created_at
             FROM ewc_admin_audit_log
            ORDER BY created_at DESC, id DESC
            LIMIT 10`,
          [],
        );
      }
      return jsonResult(data);
    },
  );

  server.registerTool(
    "search_news",
    {
      title: "Search News",
      description: "Search admin-visible news posts for the MCP key owner.",
      inputSchema: {
        query: z.string().max(120).optional(),
        status: z.enum(["draft", "published"]).optional(),
        locale: z.enum(["en", "ar"]).optional(),
        gameSlug: z.string().max(40).optional(),
        mediaSlug: z.string().max(80).optional(),
        ewcOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(25).optional(),
      },
    },
    async ({
      query = "",
      status,
      locale,
      gameSlug = "",
      mediaSlug = "",
      ewcOnly = false,
      limit = 10,
    }) => {
      assertTool(access, "search_news");
      const q = query.trim().toLowerCase();
      const cleanGame = gameSlug.trim().toLowerCase();
      const cleanMedia = mediaSlug.trim().toLowerCase();
      const posts = (await listAdminNewsPosts({
        status: status ?? null,
        gameSlug: cleanGame || null,
        mediaSlug: cleanMedia || null,
      }))
        .filter((post) => postVisibleToAccess(access, post))
        .filter((post) => !locale || post.locale === locale)
        .filter((post) => !ewcOnly || post.ewc)
        .filter((post) => {
          if (!q) return true;
          return [post.title, post.summary, post.body].some((value) => value.toLowerCase().includes(q));
        })
        .slice(0, limit)
        .map((post) => ({
          id: post.id,
          title: post.title,
          status: post.status,
          gameSlug: post.gameSlug,
          mediaSlug: post.mediaSlug,
          updatedAt: post.updatedAt,
        }));
      return jsonResult({ posts });
    },
  );

  server.registerTool(
    "get_tournament_status",
    {
      title: "Get Tournament Status",
      description: "Return matches and standings for one tracked tournament.",
      inputSchema: {
        tournamentId: z.number().int().positive(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    async ({ tournamentId, limit = 100, offset = 0 }) => {
      assertTool(access, "get_tournament_status");
      const tournament = await getTournamentById(tournamentId);
      if (!tournament) return errorResult("Tournament not found.");
      if (tournament.game && !canMcpManageGame(access, tournament.game) && !access.isSuper) {
        return errorResult("This MCP key cannot view that tournament game.");
      }
      const cleanLimit = clampInt(limit, 1, 100, 100);
      const cleanOffset = clampInt(offset, 0, 100_000, 0);
      const [matches, standings] = await Promise.all([
        all(
          `SELECT id, external_id, name, team_a, team_b, score_a, score_b, status, scheduled_at, stream_platform, stream_url
             FROM matches
            WHERE tournament_id = $1
            ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END,
                     scheduled_at ASC, id ASC
            LIMIT $2 OFFSET $3`,
          [tournamentId, cleanLimit, cleanOffset],
        ),
        listStandingsForTournament(tournamentId),
      ]);
      return jsonResult({ tournament, matches, standings, limit: cleanLimit, offset: cleanOffset });
    },
  );

  server.registerTool(
    "get_ewc_club_summary",
    {
      title: "Get EWC Club Summary",
      description: "Return EWC club points, qualified games, wins, and region metadata.",
      inputSchema: {
        query: z.string().max(120).optional(),
        region: z.enum(CLUB_REGION_IDS).optional(),
        scope: z.enum(["featured", "all"]).optional(),
        limit: z.number().int().min(1).max(60).optional(),
      },
    },
    async ({ query = "", region = "all", scope = "featured", limit = 20 }) => {
      assertTool(access, "get_ewc_club_summary");
      const tracker = await getEwcClubTrackerForMcp(8_000);
      const clubs = filterEwcClubTracker(tracker, { region, q: query, scope })
        .slice(0, clampInt(limit, 1, 60, 20))
        .map((club) => ({
          name: club.name,
          pageUrl: club.pageUrl,
          logo: club.logo,
          region: club.region,
          regionSource: club.regionSource,
          locationLabel: club.locationLabel,
          featured: club.featured,
          supportProgram: club.supportProgram,
          points: club.points,
          rank: club.rank,
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
        }));
      return jsonResult({
        sourceUrl: tracker.sourceUrl,
        standingsSourceUrl: tracker.standingsSourceUrl,
        updatedAt: tracker.updatedAt,
        summary: tracker.summary,
        dataSource: tracker.dataSource ?? "liquipedia",
        warning: tracker.warning ?? null,
        clubs,
      });
    },
  );

  server.registerTool(
    "list_admin_queue",
    {
      title: "List Admin Queue",
      description: "List comments currently needing moderation attention.",
      inputSchema: {
        limit: z.number().int().min(1).max(25).optional(),
      },
    },
    async ({ limit = 10 }) => {
      assertTool(access, "list_admin_queue");
      const comments = (await listReportedModerationComments(limit, 0)).map((comment) => ({
        id: comment.id,
        postId: comment.postId,
        authorName: comment.authorName,
        status: comment.status,
        reportOpenCount: comment.reportOpenCount,
        body: comment.body.slice(0, 500),
        createdAt: comment.createdAt,
      }));
      return jsonResult({ comments });
    },
  );

  server.registerTool(
    "create_news_draft",
    {
      title: "Create News Draft",
      description: "Create a draft news post in an allowed game or media channel.",
      inputSchema: {
        title: z.string().min(1).max(140),
        summary: z.string().max(280).optional(),
        body: z.string().max(20000).optional(),
        locale: z.enum(["en", "ar"]).optional(),
        gameSlug: z.string().optional(),
        mediaSlug: z.string().optional(),
        ewc: z.boolean().optional(),
      },
    },
    async ({ title, summary = "", body = "", locale = "en", gameSlug = "", mediaSlug = "", ewc = false }) => {
      assertTool(access, "create_news_draft");
      const cleanGame = gameSlug.trim();
      const cleanMedia = mediaSlug.trim();
      if (!cleanGame && !cleanMedia) return errorResult("gameSlug or mediaSlug is required.");
      if (cleanMedia && !canMcpManageMedia(access, cleanMedia)) return errorResult("This MCP key cannot draft for that media channel.");
      if (!cleanMedia && cleanGame && !canMcpManageGame(access, cleanGame)) return errorResult("This MCP key cannot draft for that game.");
      const post = await createNewsPost({
        gameSlug: cleanGame || null,
        mediaSlug: cleanMedia || null,
        contentMode: "shared",
        defaultLocale: locale,
        translations: {
          [locale]: { title: title.trim(), summary: summary.trim(), body: body.trim() },
        },
        status: "draft",
        authorDiscordId: access.discordUserId,
        authorName: access.displayName,
        ewc,
      });
      await auditMcp(access, "mcp.news.create_draft", String(post.id), {
        gameSlug: cleanGame || null,
        mediaSlug: cleanMedia || null,
      });
      return jsonResult({ post });
    },
  );

  server.registerTool(
    "update_stream_channel",
    {
      title: "Update Stream Channel",
      description: "Update a stream channel. Non-super keys may only update game-scoped channels they manage.",
      inputSchema: {
        id: z.number().int().positive(),
        label: z.string().max(100).optional(),
        language: z.string().max(20).optional(),
        active: z.boolean().optional(),
        isDefault: z.boolean().optional(),
        gameSlugs: z.array(z.string()).max(12).optional(),
        creatorKey: z.string().max(80).optional(),
      },
    },
    async ({ id, ...patch }) => {
      assertTool(access, "update_stream_channel");
      const existing = await getStreamChannel(id);
      if (!existing) return errorResult("Stream channel not found.");
      if (!streamAllowed(access, existing)) return errorResult("This MCP key cannot update that stream channel.");
      if (patch.gameSlugs && access.games !== "ALL" && !patch.gameSlugs.every((slug) => canMcpManageGame(access, slug))) {
        return errorResult("This MCP key cannot assign one or more requested games.");
      }
      const updated = await updateStreamChannel(id, {
        ...patch,
        propagateToGameSlugs: scopedPropagationGameSlugs(access),
      });
      await auditMcp(access, "mcp.stream.update", String(id), { active: updated?.active ?? null });
      return jsonResult({ channel: updated });
    },
  );

  registerPublicMcpTools(server, { exclude: ADMIN_PUBLIC_OVERLAP_TOOL_NAMES });

  return server;
}
