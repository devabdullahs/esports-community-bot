import "server-only";

import * as cheerio from "cheerio";
import { parsePlayerInfoboxDetails } from "@bot/services/liquipedia/entityParsers.js";
import type { PlayerProfile, TeamProfile } from "@/lib/pandascore-profiles";

export type LiquipediaAchievement = {
  title: string | null;
  image: string | null;
};

export type LiquipediaHistoryEntry = {
  period: string;
  team: string;
};

export type LiquipediaPlayerDetails = {
  romanizedName: string | null;
  status: string | null;
  team: string | null;
  totalWinnings: string | null;
  achievements: LiquipediaAchievement[];
  history: LiquipediaHistoryEntry[];
};

export type LiquipediaTeamDetails = {
  location: string | null;
  region: string | null;
  coach: string | null;
  manager: string | null;
  totalWinnings: string | null;
  created: string | null;
  achievements: LiquipediaAchievement[];
  history: LiquipediaHistoryEntry[];
};

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseFacts(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function cleanHistory(value: unknown): LiquipediaHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const period = stringValue((entry as Record<string, unknown>).period);
    const team = stringValue((entry as Record<string, unknown>).team);
    return period && team ? [{ period, team }] : [];
  });
}

function cleanAchievements(value: unknown): LiquipediaAchievement[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const title = stringValue((entry as Record<string, unknown>).title);
    const image = stringValue((entry as Record<string, unknown>).image);
    return title || image ? [{ title, image }] : [];
  });
}

export function liquipediaPlayerDetails(player: PlayerProfile): LiquipediaPlayerDetails {
  const facts = parseFacts(player.liquipedia_facts);
  const rawDetails = player.liquipedia_raw
    ? parsePlayerInfoboxDetails(cheerio.load(player.liquipedia_raw))
    : { achievements: [], history: [] };

  return {
    romanizedName: stringValue(facts.romanized_name),
    status: stringValue(facts.status),
    team: stringValue(facts.team) ?? stringValue(facts.current_team),
    totalWinnings: stringValue(facts.approx_total_winnings) ?? stringValue(facts.total_winnings) ?? stringValue(facts.earnings),
    achievements: cleanAchievements(facts.achievements).length
      ? cleanAchievements(facts.achievements)
      : rawDetails.achievements,
    history: cleanHistory(facts.history).length ? cleanHistory(facts.history) : rawDetails.history,
  };
}

export function liquipediaTeamDetails(team: TeamProfile): LiquipediaTeamDetails {
  const facts = parseFacts(team.liquipedia_facts);
  const rawDetails = team.liquipedia_raw
    ? parsePlayerInfoboxDetails(cheerio.load(team.liquipedia_raw))
    : { achievements: [], history: [] };

  return {
    location: stringValue(facts.location) ?? stringValue(facts.country),
    region: stringValue(facts.region),
    coach: stringValue(facts.coach) ?? stringValue(facts.head_coach),
    manager: stringValue(facts.manager),
    totalWinnings: stringValue(facts.approx_total_winnings) ?? stringValue(facts.total_winnings) ?? stringValue(facts.earnings),
    created: stringValue(facts.created) ?? stringValue(facts.founded),
    achievements: cleanAchievements(facts.achievements).length
      ? cleanAchievements(facts.achievements)
      : rawDetails.achievements,
    history: cleanHistory(facts.history).length ? cleanHistory(facts.history) : rawDetails.history,
  };
}
