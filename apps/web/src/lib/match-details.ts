import "server-only";

import { get } from "@bot/db/client.js";
import { getMatchDetails } from "@bot/db/matchDetails.js";
import { isEwcTournamentReference } from "@bot/lib/ewcTournament.js";
import { getTournamentOverview } from "@bot/db/officialEwcSheets.js";
import { resolveDefaultGuildId } from "@/lib/guild";
import { liveCoStreamsByMatch, type MatchCoStream } from "@/lib/match-co-streams";
import type { MatchStatus, ResultReason, WinnerSide } from "@/lib/match-lifecycle";
import { safeUrlOrUndefined } from "@/lib/safe-url";

type Side = "a" | "b";
type SidePlayers<T> = { a: T[]; b: T[] };
type RawRecord = Record<string, unknown>;
const OFFICIAL_ATTRIBUTION = "© Esports Foundation 2026. All rights reserved." as const;
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

type DetailBase = {
  version: 1;
  patch: string | null;
  casters: string[];
  attribution: string | null;
};

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

export type BattleRoyaleEntry = {
  rank: number | null;
  team: string;
  logo: string | null;
  placement: number | null;
  kills: number | null;
  points: number | null;
};

export type BattleRoyaleDetails = DetailBase & {
  kind: "battle-royale";
  gameNumber: number | null;
  entries: BattleRoyaleEntry[];
};

export type IndividualDetails = DetailBase & {
  kind: "individual";
  round: string | null;
  scoreA: number | null;
  scoreB: number | null;
  penaltyA: number | null;
  penaltyB: number | null;
};

export type TeamSeriesDetails = DetailBase & {
  kind: "teamSeries";
  maps: {
    name: string | null;
    mode: string | null;
    round: string | null;
    pickedBy: string | null;
    // The map the veto leaves behind: chosen by neither team, so it never has a picker.
    decider: boolean;
    scoreA: number | null;
    scoreB: number | null;
    winner: string | null;
    // One ban per team per map in the official Overwatch log; null when the sheet has none.
    bans: { a: DraftEntry | null; b: DraftEntry | null } | null;
    // Rainbow Six chooses starting sides per map during the veto.
    sidePick: { team: string | null; side: string } | null;
    otSidePick: { team: string | null; side: string } | null;
  }[];
  // Map bans belong to the SERIES, not to any one map: Rainbow Six bans maps out of the
  // pool before picking, where Overwatch bans heroes on each map individually.
  mapBans: { map: string; team: string | null; order: number | null }[];
};

export type OfficialBattleRoyaleDetails = DetailBase & {
  kind: "battleRoyale";
  gameLabel: string | null;
  standings: {
    rank: number | null;
    team: string | null;
    placementPoints: number | null;
    eliminationPoints: number | null;
    totalPoints: number | null;
  }[];
};

export type DraftEntry = { hero: string | null; order: number | null };
export type MatchDetailsViewModel =
  | ValorantDetails
  | DotaDetails
  | BattleRoyaleDetails
  | IndividualDetails
  | TeamSeriesDetails
  | OfficialBattleRoyaleDetails;

export type MatchPageModel = {
  id: number;
  source: string;
  externalId: string;
  status: MatchStatus;
  winnerSide: WinnerSide;
  resultReason: ResultReason;
  teamA: string | null;
  teamB: string | null;
  logoA: string | null;
  logoB: string | null;
  scoreA: number | null;
  scoreB: number | null;
  scheduledAt: number | null;
  stream: { platform: string | null; url: string | null };
  coStreams: MatchCoStream[];
  tournament: {
    id: number;
    name: string | null;
    game: string | null;
    source: string;
    url: string | null;
  };
  details: MatchDetailsViewModel | null;
  attribution: string | null;
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

// The side is the point of the entry, so drop a choice that has lost it; the team may be
// missing on its own, which only costs the label.
function mapSideChoice(value: unknown): { team: string | null; side: string } | null {
  const row = record(value);
  const choice = row ? text(row.side) : null;
  return choice ? { team: row ? text(row.team) : null, side: choice } : null;
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
    attribution: raw.attribution === OFFICIAL_ATTRIBUTION ? OFFICIAL_ATTRIBUTION : null,
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

  if (raw.kind === "battle-royale") {
    const entries = valueByLabel(raw.entries, (entry) => ({
      rank: number(entry.rank),
      team: text(entry.team),
      logo: safeUrlOrUndefined(text(entry.logo)) ?? null,
      placement: number(entry.placement),
      kills: number(entry.kills),
      points: number(entry.points),
    })).flatMap((entry) => (entry.team ? [{ ...entry, team: entry.team }] : []));
    if (!entries.length) return null;
    return {
      ...base,
      kind: "battle-royale",
      gameNumber: number(raw.gameNumber),
      entries,
    };
  }

  if (raw.kind === "individual") {
    return {
      ...base,
      kind: "individual",
      round: text(raw.round),
      scoreA: number(raw.scoreA),
      scoreB: number(raw.scoreB),
      penaltyA: number(raw.penaltyA),
      penaltyB: number(raw.penaltyB),
    };
  }

  if (raw.kind === "teamSeries") {
    return {
      ...base,
      kind: "teamSeries",
      maps: valueByLabel(raw.maps, (map) => {
        const bans = record(map.bans);
        const banA = bans ? record(bans.a) : null;
        const banB = bans ? record(bans.b) : null;
        return {
          name: text(map.name),
          mode: text(map.mode),
          round: text(map.round),
          pickedBy: text(map.pickedBy),
          decider: map.decider === true,
          scoreA: number(map.scoreA),
          scoreB: number(map.scoreB),
          winner: text(map.winner),
          bans: banA || banB
            ? { a: banA ? mapDraftEntry(banA) : null, b: banB ? mapDraftEntry(banB) : null }
            : null,
          sidePick: mapSideChoice(map.sidePick),
          otSidePick: mapSideChoice(map.otSidePick),
        };
      }).slice(0, 30),
      mapBans: valueByLabel(raw.mapBans, (ban) => ({
        map: text(ban.map),
        team: text(ban.team),
        order: number(ban.order),
      }))
        .flatMap((ban) => (ban.map ? [{ ...ban, map: ban.map }] : []))
        .slice(0, 30),
    };
  }

  if (raw.kind === "battleRoyale") {
    return {
      ...base,
      kind: "battleRoyale",
      gameLabel: text(raw.gameLabel),
      standings: valueByLabel(raw.standings, (entry) => ({
        rank: number(entry.rank),
        team: text(entry.team),
        placementPoints: number(entry.placementPoints),
        eliminationPoints: number(entry.eliminationPoints),
        totalPoints: number(entry.totalPoints),
      })).slice(0, 80),
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
  winner_side: WinnerSide;
  result_reason: ResultReason;
  scheduled_at: number | null;
  stream_platform: string | null;
  stream_url: string | null;
  tournament_id: number;
  tournament_name: string | null;
  tournament_source: string;
  tournament_url: string | null;
  tournament_external_id: string;
  tournament_ewc: number | null;
  game: string | null;
};

export async function getMatchPageModel(matchId: number): Promise<MatchPageModel | null> {
  const guildId = await resolveDefaultGuildId();
  if (!guildId) return null;
  const match = (await get(
    `SELECT m.id, m.source, m.external_id, m.status, m.team_a, m.team_b, m.logo_a, m.logo_b,
            m.score_a, m.score_b, m.winner_side, m.result_reason,
            m.scheduled_at, m.stream_platform, m.stream_url,
            t.id AS tournament_id, t.name AS tournament_name, t.game,
            t.source AS tournament_source, t.url AS tournament_url,
            t.external_id AS tournament_external_id, t.ewc AS tournament_ewc
       FROM matches m
       JOIN tournaments t ON t.id = m.tournament_id
      WHERE m.id = $1
        AND t.active = 1
        AND t.guild_id = $2`,
    [matchId, guildId],
  )) as MatchDbRow | null;
  if (!match) return null;

  const coStreamsPromise = match.status === "running"
    ? liveCoStreamsByMatch(
      [{
        id: match.id,
        external_id: match.external_id,
        team_a: match.team_a,
        team_b: match.team_b,
      }],
      {
        gameSlug: match.game,
        includeEwc: isEwcTournamentReference({
          name: match.tournament_name,
          url: match.tournament_url,
          external_id: match.tournament_external_id,
          ewc: match.tournament_ewc,
        }),
      },
    )
    : Promise.resolve(new Map<number, MatchCoStream[]>());
  const [details, coStreamsByMatch, overview] = await Promise.all([
    getMatchDetails(matchId),
    coStreamsPromise,
    getTournamentOverview(match.tournament_id),
  ]);
  const streamUrl = safeUrlOrUndefined(match.stream_url) ?? null;
  const tournamentUrl = safeUrlOrUndefined(match.tournament_url) ?? null;
  const overviewAttribution =
    overview?.payload &&
    typeof overview.payload === "object" &&
    !Array.isArray(overview.payload) &&
    (overview.payload as Record<string, unknown>).attribution === OFFICIAL_ATTRIBUTION
      ? OFFICIAL_ATTRIBUTION
      : null;
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
    winnerSide: match.winner_side,
    resultReason: match.result_reason,
    scheduledAt: match.scheduled_at,
    stream: {
      platform: streamUrl ? match.stream_platform : null,
      url: streamUrl,
    },
    coStreams: coStreamsByMatch.get(match.id) ?? [],
    tournament: {
      id: match.tournament_id,
      name: match.tournament_name,
      game: match.game,
      source: match.tournament_source,
      url: tournamentUrl,
    },
    details: toMatchDetailsViewModel(details?.payload),
    attribution: overviewAttribution,
  };
}
