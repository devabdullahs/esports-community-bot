import "server-only";

import { unstable_cache } from "next/cache";
import { listEwcClubChampionshipSnapshotHistory } from "@bot/db/ewcClubChampionshipSnapshots.js";
import { clubKey } from "@/lib/ewc-club-regions";

export const EWC_CLUB_HISTORY_MAX_SNAPSHOTS = 60;
export const EWC_CLUB_HISTORY_DAYS = 120;
export const EWC_CLUB_HISTORY_TOP_CLUBS = 4;

type RawStanding = {
  rank?: unknown;
  team?: unknown;
  points?: unknown;
};

export type EwcClubHistorySnapshot = {
  fetchedAt: string;
  standings: readonly RawStanding[];
};

export type EwcClubHistoryPoint = {
  fetchedAt: string;
  points: number;
  rank: number | null;
  delta: number | null;
  rankDelta: number | null;
};

export type EwcClubHistorySeries = {
  key: string;
  name: string;
  points: EwcClubHistoryPoint[];
};

export type EwcClubHistoryMover = {
  key: string;
  name: string;
  points: number;
  rank: number | null;
  delta: number;
  rankDelta: number | null;
};

export type EwcClubHistory = {
  snapshotCount: number;
  selectedClub: string | null;
  series: EwcClubHistorySeries[];
  movers: EwcClubHistoryMover[];
};

type ClubObservation = {
  name: string;
  points: number | null;
  rank: number | null;
};

function finiteNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const number = Number(value.replace(/,/g, ""));
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function standingRank(value: unknown) {
  const rank = finiteNumber(value);
  return rank != null && Number.isInteger(rank) && rank > 0 ? rank : null;
}

function cleanTeamName(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function canonicalEwcClubHistoryKey(value: unknown) {
  const base = clubKey(value);
  if (!base) return "";
  const withoutPrefix = base.replace(/^team\s+/, "");
  const withoutSuffix = withoutPrefix.replace(/\s+esports$/, "");
  const compact = withoutSuffix.replace(/[^a-z0-9]+/g, "");
  return compact || withoutSuffix;
}

export function cleanEwcClubHistorySelection(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function cleanSnapshotLimit(value: number | undefined) {
  if (!Number.isFinite(value)) return EWC_CLUB_HISTORY_MAX_SNAPSHOTS;
  return Math.min(EWC_CLUB_HISTORY_MAX_SNAPSHOTS, Math.max(1, Math.floor(value as number)));
}

function preferObservation(candidate: ClubObservation, current: ClubObservation) {
  if (candidate.points != null && current.points == null) return true;
  if (candidate.points != null && current.points != null && candidate.points > current.points) return true;
  if (candidate.rank != null && current.rank == null) return true;
  if (candidate.rank != null && current.rank != null && candidate.rank < current.rank) return true;
  return candidate.name.length > current.name.length;
}

function observationsForSnapshot(snapshot: EwcClubHistorySnapshot) {
  const observations = new Map<string, ClubObservation>();
  for (const row of snapshot.standings) {
    const name = cleanTeamName(row.team);
    const key = canonicalEwcClubHistoryKey(name);
    if (!key) continue;
    const candidate = {
      name,
      points: finiteNumber(row.points),
      rank: standingRank(row.rank),
    };
    const current = observations.get(key);
    if (!current || preferObservation(candidate, current)) observations.set(key, candidate);
  }
  return observations;
}

function normalizedSnapshots(snapshots: readonly EwcClubHistorySnapshot[], maxSnapshots: number) {
  const byFetchedAt = new Map<string, EwcClubHistorySnapshot>();
  for (const snapshot of snapshots) {
    const time = new Date(snapshot.fetchedAt).getTime();
    if (!Number.isFinite(time) || !Array.isArray(snapshot.standings)) continue;
    byFetchedAt.set(new Date(time).toISOString(), {
      fetchedAt: new Date(time).toISOString(),
      standings: snapshot.standings,
    });
  }
  return [...byFetchedAt.values()]
    .sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt))
    .slice(-maxSnapshots);
}

export function projectEwcClubHistory(
  snapshots: readonly EwcClubHistorySnapshot[],
  {
    selectedClub = "",
    maxSnapshots = EWC_CLUB_HISTORY_MAX_SNAPSHOTS,
    topClubs = EWC_CLUB_HISTORY_TOP_CLUBS,
  }: {
    selectedClub?: string;
    maxSnapshots?: number;
    topClubs?: number;
  } = {},
): EwcClubHistory {
  const normalized = normalizedSnapshots(snapshots, cleanSnapshotLimit(maxSnapshots));
  const observationsByClub = new Map<string, Map<string, ClubObservation>>();

  for (const snapshot of normalized) {
    for (const [key, observation] of observationsForSnapshot(snapshot)) {
      const timeline = observationsByClub.get(key) ?? new Map<string, ClubObservation>();
      timeline.set(snapshot.fetchedAt, observation);
      observationsByClub.set(key, timeline);
    }
  }

  const candidates = [...observationsByClub].flatMap(([key, timeline]) => {
    const points: EwcClubHistoryPoint[] = [];
    let previous: EwcClubHistoryPoint | null = null;
    let name = "";
    for (const snapshot of normalized) {
      const observation = timeline.get(snapshot.fetchedAt);
      if (!observation || observation.points == null) continue;
      name = observation.name;
      const point: EwcClubHistoryPoint = {
        fetchedAt: snapshot.fetchedAt,
        points: observation.points,
        rank: observation.rank,
        delta: previous ? observation.points - previous.points : null,
        rankDelta:
          previous?.rank != null && observation.rank != null
            ? previous.rank - observation.rank
            : null,
      };
      points.push(point);
      previous = point;
    }
    if (!points.length) return [];
    return [{ key, name, points }];
  });

  const ordered = candidates.sort((a, b) => {
    const latestA = a.points.at(-1)!;
    const latestB = b.points.at(-1)!;
    const points = latestB.points - latestA.points;
    if (points) return points;
    const rank = (latestA.rank ?? Number.POSITIVE_INFINITY) - (latestB.rank ?? Number.POSITIVE_INFINITY);
    if (rank) return rank;
    return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  });
  const selectedKey = canonicalEwcClubHistoryKey(selectedClub);
  const selected = selectedKey ? ordered.find((series) => series.key === selectedKey) ?? null : null;
  const boundedTopClubs = Number.isFinite(topClubs) ? Math.max(1, Math.floor(topClubs)) : EWC_CLUB_HISTORY_TOP_CLUBS;
  const series = ordered.slice(0, boundedTopClubs);
  if (selected && !series.some((item) => item.key === selected.key)) series.push(selected);

  const movers = ordered
    .flatMap((item): EwcClubHistoryMover[] => {
      const latest = item.points.at(-1)!;
      if (latest.delta == null && latest.rankDelta == null) return [];
      if (!latest.delta && !latest.rankDelta) return [];
      return [{
        key: item.key,
        name: item.name,
        points: latest.points,
        rank: latest.rank,
        delta: latest.delta ?? 0,
        rankDelta: latest.rankDelta,
      }];
    })
    .sort((a, b) => {
      const points = Math.abs(b.delta) - Math.abs(a.delta);
      if (points) return points;
      const rank = Math.abs(b.rankDelta ?? 0) - Math.abs(a.rankDelta ?? 0);
      if (rank) return rank;
      return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
    })
    .slice(0, 3);

  return {
    snapshotCount: normalized.length,
    selectedClub: selected?.name ?? null,
    series,
    movers,
  };
}

function historySince(now = Date.now()) {
  return new Date(now - EWC_CLUB_HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

async function loadEwcClubHistory(season: string, selectedClub = "") {
  const snapshots = await listEwcClubChampionshipSnapshotHistory(season, {
    since: historySince(),
    limit: EWC_CLUB_HISTORY_MAX_SNAPSHOTS,
  });
  return projectEwcClubHistory(snapshots, { selectedClub });
}

export const getEwcClubHistoryCached = unstable_cache(
  loadEwcClubHistory,
  ["ewc-club-championship-history-v1"],
  { revalidate: 60 },
);
