import "server-only";

import { get } from "@bot/db/client.js";
import { getMatchDetails } from "@bot/db/matchDetails.js";
import { resolveDefaultGuildId } from "@/lib/guild";

type Side = "a" | "b";
type SidePlayers<T> = { a: T[]; b: T[] };
type RawRecord = Record<string, unknown>;
export type DotaTeamStats = {
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  gold: string | null;
  towers: number | null;
  barracks: number | null;
  roshans: number | null;
};

export type ValorantPlayer = {
  name: string | null;
  agents: string[];
  acs: number | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  kastPct: string | null;
  adr: number | null;
  hsPct: string | null;
  fk: number | null;
  fd: number | null;
};

export type DotaPlayer = {
  name: string | null;
  hero: string | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  dmg: string | null;
  lhdn: string | null;
  net: string | null;
  gpm: number | null;
};

type DetailBase = { version: 1; patch: string | null; casters: string[] };

export type ValorantDetails = DetailBase & {
  kind: "valorant";
  veto: { order: number | null; action: "ban" | "pick" | "decider"; map: string | null; team: Side | null }[];
  maps: {
    name: string | null;
    duration: string | null;
    scoreA: number | null;
    scoreB: number | null;
    winner: Side | null;
    players: SidePlayers<ValorantPlayer>;
  }[];
};

export type DotaDetails = DetailBase & {
  kind: "dota2";
  games: {
    number: number | null;
    duration: string | null;
    winner: Side | null;
    sides: { a: string | null; b: string | null };
    draft: {
      a: { picks: DraftEntry[]; bans: DraftEntry[] };
      b: { picks: DraftEntry[]; bans: DraftEntry[] };
    };
    teamStats: { a: DotaTeamStats; b: DotaTeamStats };
    players: SidePlayers<DotaPlayer>;
  }[];
};

export type DraftEntry = { hero: string | null; order: number | null };
export type MatchDetailsViewModel = ValorantDetails | DotaDetails;

export type MatchPageModel = {
  id: number;
  source: string;
  externalId: string;
  status: "running" | "scheduled" | "finished";
  teamA: string | null;
  teamB: string | null;
  logoA: string | null;
  logoB: string | null;
  scoreA: number | null;
  scoreB: number | null;
  scheduledAt: number | null;
  stream: { platform: string | null; url: string | null };
  tournament: { id: number; name: string | null; game: string | null };
  details: MatchDetailsViewModel | null;
};

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RawRecord) : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function side(value: unknown): Side | null {
  return value === "a" || value === "b" ? value : null;
}

function sidePlayers<T>(value: unknown, map: (item: RawRecord) => T): SidePlayers<T> {
  const raw = record(value);
  const rows = (key: Side) => list(raw?.[key]).flatMap((item) => {
    const row = record(item);
    return row ? [map(row)] : [];
  });
  return { a: rows("a"), b: rows("b") };
}

function sideValues<T>(value: unknown, map: (item: RawRecord) => T): { a: T; b: T } {
  const raw = record(value);
  return { a: map(record(raw?.a) ?? {}), b: map(record(raw?.b) ?? {}) };
}

function valueByLabel<T>(value: unknown, map: (item: RawRecord) => T): T[] {
  return list(value).flatMap((item) => {
    const row = record(item);
    return row ? [map(row)] : [];
  });
}

function mapValorantPlayer(row: RawRecord): ValorantPlayer {
  return {
    name: text(row.name),
    agents: list(row.agents).flatMap((agent) => (text(agent) ? [text(agent) as string] : [])),
    acs: number(row.acs),
    kills: number(row.kills),
    deaths: number(row.deaths),
    assists: number(row.assists),
    kastPct: text(row.kastPct),
    adr: number(row.adr),
    hsPct: text(row.hsPct),
    fk: number(row.fk),
    fd: number(row.fd),
  };
}

function mapDotaPlayer(row: RawRecord): DotaPlayer {
  return {
    name: text(row.name),
    hero: text(row.hero),
    kills: number(row.kills),
    deaths: number(row.deaths),
    assists: number(row.assists),
    dmg: text(row.dmg),
    lhdn: text(row.lhdn),
    net: text(row.net),
    gpm: number(row.gpm),
  };
}

function mapDraftEntry(row: RawRecord): DraftEntry {
  return { hero: text(row.hero), order: number(row.order) };
}

function mapTeamStats(row: RawRecord) {
  return {
    kills: number(row.kills),
    deaths: number(row.deaths),
    assists: number(row.assists),
    gold: text(row.gold),
    towers: number(row.towers),
    barracks: number(row.barracks),
    roshans: number(row.roshans),
  };
}

function common(raw: RawRecord): DetailBase | null {
  if (number(raw.version) !== 1) return null;
  return {
    version: 1,
    patch: text(raw.patch),
    casters: list(raw.casters).flatMap((caster) => (text(caster) ? [text(caster) as string] : [])),
  };
}

// This is deliberately pure: tests and any later API surface can validate the
// stored envelope without importing the database layer.
export function toMatchDetailsViewModel(payload: unknown): MatchDetailsViewModel | null {
  const raw = record(payload);
  if (!raw) return null;
  const base = common(raw);
  if (!base) return null;

  if (raw.kind === "valorant") {
    return {
      ...base,
      kind: "valorant",
      veto: valueByLabel(raw.veto, (entry) => ({
        order: number(entry.order),
        action: entry.action === "pick" || entry.action === "decider" ? entry.action : "ban",
        map: text(entry.map),
        team: side(entry.team),
      })),
      maps: valueByLabel(raw.maps, (map) => ({
        name: text(map.name),
        duration: text(map.duration),
        scoreA: number(map.scoreA),
        scoreB: number(map.scoreB),
        winner: side(map.winner),
        players: sidePlayers(map.players, mapValorantPlayer),
      })),
    };
  }

  if (raw.kind === "dota2") {
    return {
      ...base,
      kind: "dota2",
      games: valueByLabel(raw.games, (game) => {
        const draft = record(game.draft);
        const stats = record(game.teamStats);
        const draftSide = (key: Side) => {
          const teamDraft = record(draft?.[key]);
          return { picks: valueByLabel(teamDraft?.picks, mapDraftEntry), bans: valueByLabel(teamDraft?.bans, mapDraftEntry) };
        };
        const sides = record(game.sides);
        return {
          number: number(game.number),
          duration: text(game.duration),
          winner: side(game.winner),
          sides: { a: text(sides?.a), b: text(sides?.b) },
          draft: { a: draftSide("a"), b: draftSide("b") },
          teamStats: sideValues(stats, mapTeamStats),
          players: sidePlayers(game.players, mapDotaPlayer),
        };
      }),
    };
  }
  return null;
}

type MatchDbRow = {
  id: number;
  source: string;
  external_id: string;
  status: MatchPageModel["status"];
  team_a: string | null;
  team_b: string | null;
  logo_a: string | null;
  logo_b: string | null;
  score_a: number | null;
  score_b: number | null;
  scheduled_at: number | null;
  stream_platform: string | null;
  stream_url: string | null;
  tournament_id: number;
  tournament_name: string | null;
  game: string | null;
};

export async function getMatchPageModel(matchId: number): Promise<MatchPageModel | null> {
  const guildId = await resolveDefaultGuildId();
  if (!guildId) return null;
  const match = (await get(
    `SELECT m.id, m.source, m.external_id, m.status, m.team_a, m.team_b, m.logo_a, m.logo_b,
            m.score_a, m.score_b, m.scheduled_at, m.stream_platform, m.stream_url,
            t.id AS tournament_id, t.name AS tournament_name, t.game
       FROM matches m
       JOIN tournaments t ON t.id = m.tournament_id
      WHERE m.id = $1
        AND t.active = 1
        AND t.guild_id = $2`,
    [matchId, guildId],
  )) as MatchDbRow | null;
  if (!match) return null;

  const details = await getMatchDetails(matchId);
  return {
    id: match.id,
    source: match.source,
    externalId: match.external_id,
    status: match.status,
    teamA: match.team_a,
    teamB: match.team_b,
    logoA: match.logo_a,
    logoB: match.logo_b,
    scoreA: match.score_a,
    scoreB: match.score_b,
    scheduledAt: match.scheduled_at,
    stream: { platform: match.stream_platform, url: match.stream_url },
    tournament: { id: match.tournament_id, name: match.tournament_name, game: match.game },
    details: toMatchDetailsViewModel(details?.payload),
  };
}
