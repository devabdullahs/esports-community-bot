import "server-only";

import { unstable_cache } from "next/cache";
import { clubKey, clubKeys, type ClubRegionId } from "@/lib/ewc-club-regions";
import {
  getEwcClubTrackerCached,
  type EwcClubTracker,
} from "@/lib/ewc-clubs";

export type EwcClubStandingEligibility = "champion" | "prize" | null;

export type EwcClubStandingCandidate = {
  name: string;
  logo?: string | null;
  rank?: number | null;
  points?: number | null;
  eligibility?: string | null;
  hasStanding?: boolean;
  qualifiedGames?: readonly unknown[];
  wins?: readonly unknown[];
  region: Exclude<ClubRegionId, "all">;
  locationLabel?: string | null;
  featured?: boolean;
};

export type EwcClubStandingRow = {
  rank: number | null;
  name: string;
  logo: string | null;
  points: number | null;
  eligibility: EwcClubStandingEligibility;
  qualifiedGameCount: number;
  wins: number;
  region: Exclude<ClubRegionId, "all">;
  locationLabel: string | null;
};

export type EwcClubStandings = Pick<
  EwcClubTracker,
  "season" | "updatedAt" | "dataSource" | "stale" | "warning"
> & {
  sourceUrl: string;
  rows: EwcClubStandingRow[];
};

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function officialRank(value: unknown) {
  const rank = finiteNumber(value);
  return rank != null && Number.isInteger(rank) && rank > 0 ? rank : null;
}

function eligibility(value: unknown): EwcClubStandingEligibility {
  return value === "champion" || value === "prize" ? value : null;
}

export function projectEwcClubStandings(
  clubs: readonly EwcClubStandingCandidate[],
): EwcClubStandingRow[] {
  return clubs
    .filter((club) => club.hasStanding !== false && clubKey(club.name))
    .map((club) => ({
      rank: officialRank(club.rank),
      name: club.name.trim(),
      logo: club.logo?.trim() || null,
      points: finiteNumber(club.points),
      eligibility: eligibility(club.eligibility),
      qualifiedGameCount: club.qualifiedGames?.length ?? 0,
      wins: club.wins?.length ?? 0,
      region: club.region,
      locationLabel: club.locationLabel?.trim() || null,
    }))
    .sort((a, b) => {
      const rank = (a.rank ?? Number.POSITIVE_INFINITY) - (b.rank ?? Number.POSITIVE_INFINITY);
      if (rank) return rank;
      const points = (b.points ?? Number.NEGATIVE_INFINITY) - (a.points ?? Number.NEGATIVE_INFINITY);
      if (points) return points;
      return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
    });
}

export function filterEwcClubStandings(
  rows: readonly EwcClubStandingRow[],
  { region = "all", q = "" }: { region?: ClubRegionId; q?: string } = {},
) {
  const query = clubKey(q);
  return rows.filter((row) => {
    if (region !== "all" && row.region !== region) return false;
    return !query || clubKeys(row.name).some((key) => key.includes(query));
  });
}

async function loadEwcClubStandings(): Promise<EwcClubStandings> {
  const tracker = await getEwcClubTrackerCached();
  return {
    season: tracker.season,
    sourceUrl: tracker.standingsSourceUrl,
    updatedAt: tracker.updatedAt,
    dataSource: tracker.dataSource,
    stale: tracker.stale,
    ...(tracker.warning ? { warning: tracker.warning } : {}),
    rows: projectEwcClubStandings(tracker.clubs),
  };
}

export const getEwcClubStandingsCached = unstable_cache(
  loadEwcClubStandings,
  ["ewc-club-championship-standings-v1"],
  { revalidate: 60 },
);
