import "server-only";

import { all } from "@bot/db/client.js";
import { listStandingsForTournament as _listStandings } from "@bot/db/tournamentStandings.js";
import { renderAdminGraphic as _renderAdminGraphic } from "@bot/lib/adminGraphicsCard.js";
import { canManageGame, canManageMedia, type AdminAccess } from "@/lib/admin";
import { getMediaChannel, listMediaChannels } from "@/lib/media";
import { getNewsPost, listAdminNewsPosts } from "@/lib/news";
import { resolveDefaultGuildId } from "@/lib/guild";
import {
  type GraphicsGeneratorData,
  type GraphicsOption,
  type GraphicsOwner,
  type GraphicsRenderRequest,
  type GraphicsRenderOptions,
} from "@/lib/graphics-generator-model";

type RenderOptions = GraphicsRenderOptions & {
  brandLogo: string | null;
};

type MatchGraphic = {
  template: "match-result";
  owner: GraphicsOwner;
  target: { id: number; label: string };
  input: RenderOptions & {
    template: "match-result";
    tournament: string;
    game: string;
    teamA: string;
    teamB: string;
    logoA: string | null;
    logoB: string | null;
    scoreA: number | null;
    scoreB: number | null;
    status: "live" | "finished" | "upcoming";
  };
};

type StandingsGraphic = {
  template: "standings";
  owner: GraphicsOwner;
  target: { id: number; label: string };
  input: RenderOptions & {
    template: "standings";
    tournament: string;
    section: string;
    entries: Array<{ rank: number; team: string; logo: string | null; points: string; extra: string }>;
  };
};

type NewsGraphic = {
  template: "news-promo";
  owner: GraphicsOwner;
  target: { id: number; label: string };
  input: RenderOptions & {
    template: "news-promo";
    owner: string;
    title: string;
    summary: string;
  };
};

export type ResolvedGraphicsRender = MatchGraphic | StandingsGraphic | NewsGraphic;

type StandingsRow = {
  section: string;
  rank: number;
  team: string;
  logo: string | null;
  points: string;
  extra: string;
};

const listStandings = _listStandings as (tournamentId: number) => Promise<StandingsRow[]>;
const renderAdminGraphic = _renderAdminGraphic as unknown as (
  input: ResolvedGraphicsRender["input"],
) => Promise<Buffer>;

function cleanText(value: unknown, fallback: string, maxLength = 120): string {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
  return text || fallback;
}

function cleanId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function ownerForRow(row: { game?: unknown; mediaSlug?: unknown; gameSlug?: unknown }): GraphicsOwner | null {
  const mediaSlug = cleanText(row.mediaSlug, "", 80);
  if (mediaSlug) return { kind: "media", slug: mediaSlug };
  const gameSlug = cleanText(row.gameSlug ?? row.game, "", 80);
  return gameSlug ? { kind: "game", slug: gameSlug } : null;
}

export function canManageGraphicsOwner(access: AdminAccess, owner: GraphicsOwner): boolean {
  return owner.kind === "game"
    ? canManageGame(access, owner.slug)
    : canManageMedia(access, owner.slug);
}

export function filterGraphicsGeneratorData(
  access: AdminAccess,
  data: GraphicsGeneratorData,
): GraphicsGeneratorData {
  const scoped = (options: GraphicsOption[]) =>
    options.filter((option) => canManageGraphicsOwner(access, option.owner));
  return {
    matches: scoped(data.matches),
    standings: scoped(data.standings),
    news: scoped(data.news),
  };
}

export async function listGraphicsGeneratorData(access: AdminAccess): Promise<GraphicsGeneratorData> {
  const guildId = await resolveDefaultGuildId();
  if (!guildId) return { matches: [], standings: [], news: [] };

  const [matchRows, standingsRows, posts, mediaChannels] = await Promise.all([
    all(
      `SELECT m.id, m.team_a, m.team_b, m.logo_a, m.logo_b, m.score_a, m.score_b,
              m.status, t.game, t.name AS tournament_name
       FROM matches m
       JOIN tournaments t ON t.id = m.tournament_id
       WHERE t.guild_id = $1
         AND t.active = 1
         AND m.status IN ('live', 'finished', 'upcoming')
       ORDER BY COALESCE(m.scheduled_at, 0) DESC, m.id DESC
       LIMIT 250`,
      [guildId],
    ) as Promise<Array<Record<string, unknown>>>,
    all(
      `SELECT DISTINCT t.id, t.game, t.name
       FROM tournaments t
       JOIN tournament_standings s ON s.tournament_id = t.id
       WHERE t.guild_id = $1 AND t.active = 1
       ORDER BY t.id DESC
       LIMIT 250`,
      [guildId],
    ) as Promise<Array<Record<string, unknown>>>,
    listAdminNewsPosts(),
    listMediaChannels(),
  ]);

  const mediaLogoBySlug = new Map(mediaChannels.map((channel) => [channel.slug, channel.logoUrl]));

  const matches = matchRows.flatMap((row): GraphicsOption[] => {
    const owner = ownerForRow(row);
    const id = cleanId(row.id);
    if (!owner || !id) return [];
    const teamA = cleanText(row.team_a, "TBD", 70);
    const teamB = cleanText(row.team_b, "TBD", 70);
    const hasScore = row.score_a !== null && row.score_a !== undefined
      && row.score_b !== null && row.score_b !== undefined;
    return [{
      id,
      label: hasScore
        ? `${teamA} ${cleanText(row.score_a, "-", 8)} - ${cleanText(row.score_b, "-", 8)} ${teamB}`
        : `${teamA} vs ${teamB}`,
      detail: cleanText(row.tournament_name, owner.slug, 100),
      owner,
      status: row.status === "live" ? "live" : row.status === "finished" ? "final" : "soon",
    }];
  });
  const standings = standingsRows.flatMap((row): GraphicsOption[] => {
    const owner = ownerForRow(row);
    const id = cleanId(row.id);
    if (!owner || !id) return [];
    return [{
      id,
      label: cleanText(row.name, "Tournament", 120),
      detail: owner.slug,
      owner,
      status: "soon",
    }];
  });
  const news = posts.flatMap((post): GraphicsOption[] => {
    const owner = ownerForRow({ mediaSlug: post.mediaSlug, gameSlug: post.gameSlug });
    if (!owner) return [];
    return [{
      id: post.id,
      label: cleanText(post.title, "Untitled post", 120),
      detail: owner.slug,
      owner,
      status: "final",
      brandLogoUrl: owner.kind === "media" ? mediaLogoBySlug.get(owner.slug) ?? null : null,
    }];
  });

  return filterGraphicsGeneratorData(access, { matches, standings, news });
}

export async function resolveGraphicsRenderRequest(
  request: GraphicsRenderRequest,
): Promise<ResolvedGraphicsRender | null> {
  const guildId = await resolveDefaultGuildId();
  if (!guildId) return null;
  const options: GraphicsRenderOptions = {
    format: request.format,
    language: request.language,
    alignment: request.alignment,
    style: request.style,
    scale: request.scale,
    brandPlacement: request.brandPlacement,
    brandX: request.brandX,
    brandY: request.brandY,
    brandSize: request.brandSize,
  };

  if (request.template === "match-result") {
    const row = (await all(
      `SELECT m.id, m.team_a, m.team_b, m.logo_a, m.logo_b, m.score_a, m.score_b,
              m.status, t.game, t.name AS tournament_name
       FROM matches m
       JOIN tournaments t ON t.id = m.tournament_id
       WHERE m.id = $1
         AND t.guild_id = $2
         AND t.active = 1
         AND m.status IN ('live', 'finished', 'upcoming')
       LIMIT 1`,
      [request.resourceId, guildId],
    ))[0] as Record<string, unknown> | undefined;
    const owner = row ? ownerForRow(row) : null;
    const id = row ? cleanId(row.id) : null;
    if (!row || !owner || !id) return null;
    return {
      template: "match-result",
      owner,
      target: { id, label: cleanText(row.tournament_name, "Tournament", 100) },
      input: {
        ...options,
        brandLogo: null,
        template: "match-result",
        tournament: cleanText(row.tournament_name, "Tournament", 100),
        game: cleanText(row.game, owner.slug, 80),
        teamA: cleanText(row.team_a, "TBD", 70),
        teamB: cleanText(row.team_b, "TBD", 70),
        logoA: cleanText(row.logo_a, "", 1000) || null,
        logoB: cleanText(row.logo_b, "", 1000) || null,
        scoreA: row.score_a === null || row.score_a === undefined ? null : Number(row.score_a),
        scoreB: row.score_b === null || row.score_b === undefined ? null : Number(row.score_b),
        status: row.status === "live" ? "live" : row.status === "finished" ? "finished" : "upcoming",
      },
    };
  }

  if (request.template === "standings") {
    const row = (await all(
      `SELECT id, game, name
       FROM tournaments
       WHERE id = $1 AND guild_id = $2 AND active = 1
       LIMIT 1`,
      [request.resourceId, guildId],
    ))[0] as Record<string, unknown> | undefined;
    const owner = row ? ownerForRow(row) : null;
    const id = row ? cleanId(row.id) : null;
    if (!row || !owner || !id) return null;
    const rows = await listStandings(id);
    const sectionTitle = cleanText(rows.find((candidate) => cleanText(candidate.section, "", 120))?.section, "", 120);
    if (!sectionTitle) return null;
    const entries = rows
      .filter((candidate) => cleanText(candidate.section, "", 120) === sectionTitle)
      .slice(0, 6)
      .map((candidate, index) => ({
        rank: Number.isSafeInteger(Number(candidate.rank)) && Number(candidate.rank) > 0
          ? Number(candidate.rank)
          : index + 1,
        team: cleanText(candidate.team, "TBD", 80),
        logo: cleanText(candidate.logo, "", 1000) || null,
        points: cleanText(candidate.points, "", 32),
        extra: cleanText(candidate.extra, "", 32),
      }));
    if (!entries.length) return null;
    return {
      template: "standings",
      owner,
      target: { id, label: cleanText(row.name, "Tournament", 100) },
      input: {
        ...options,
        brandLogo: null,
        template: "standings",
        tournament: cleanText(row.name, "Tournament", 100),
        section: cleanText(sectionTitle, "Standings", 100),
        entries,
      },
    };
  }

  const post = await getNewsPost(request.resourceId);
  if (!post) return null;
  const owner = ownerForRow({ mediaSlug: post.mediaSlug, gameSlug: post.gameSlug });
  if (!owner) return null;
  const mediaChannel = owner.kind === "media" ? await getMediaChannel(owner.slug) : null;
  return {
    template: "news-promo",
    owner,
    target: { id: post.id, label: cleanText(post.title, "Untitled post", 100) },
    input: {
      ...options,
      brandLogo: mediaChannel?.logoUrl ?? null,
      template: "news-promo",
      owner: owner.slug,
      title: cleanText(post.title, "Community update", 150),
      summary: cleanText(post.summary, "", 220),
    },
  };
}

export function renderGraphics(resolved: ResolvedGraphicsRender): Promise<Buffer> {
  return renderAdminGraphic(resolved.input);
}
