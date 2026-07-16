import "server-only";

import { MAX_PERSONAL_CALENDAR_MATCHES, PERSONAL_CALENDAR_WINDOW_SECONDS } from "@bot/db/userFollows.js";
import { listUpcomingFollowedMatches, type CalendarMatchRow } from "@/lib/follows";

export const MATCH_CALENDAR_EVENT_DURATION_SECONDS = 2 * 60 * 60;

export type CalendarMatch = Pick<
  CalendarMatchRow,
  "id" | "tournamentId" | "tournamentName" | "game" | "teamA" | "teamB" | "scheduledAt"
>;

export type MatchCalendarPayload = {
  matches: CalendarMatch[];
  window: {
    startsAt: number;
    endsAt: number;
  };
};

export type MatchCalendarLoaders = {
  matches: typeof listUpcomingFollowedMatches;
};

const defaultLoaders: MatchCalendarLoaders = {
  matches: listUpcomingFollowedMatches,
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function isCalendarMatchInWindow(match: CalendarMatchRow, startsAt: number, endsAt: number) {
  return Number.isSafeInteger(match.id)
    && Number.isSafeInteger(match.tournamentId)
    && Number.isFinite(match.scheduledAt)
    && match.scheduledAt >= startsAt
    && match.scheduledAt <= endsAt;
}

function calendarMatchProjection(match: CalendarMatchRow): CalendarMatch {
  return {
    id: match.id,
    tournamentId: match.tournamentId,
    tournamentName: text(match.tournamentName),
    game: text(match.game),
    teamA: text(match.teamA),
    teamB: text(match.teamB),
    scheduledAt: Math.trunc(match.scheduledAt),
  };
}

export async function getMatchCalendarForViewer(
  discordUserId: string,
  nowSec: number,
  loaders: MatchCalendarLoaders = defaultLoaders,
): Promise<MatchCalendarPayload> {
  const startsAt = Math.trunc(Number(nowSec));
  if (!discordUserId || !Number.isFinite(startsAt)) {
    throw new Error("getMatchCalendarForViewer requires discordUserId and nowSec.");
  }
  const endsAt = startsAt + PERSONAL_CALENDAR_WINDOW_SECONDS;
  const matches = await loaders.matches(discordUserId, {
    nowSec: startsAt,
    limit: MAX_PERSONAL_CALENDAR_MATCHES,
  });
  const seen = new Set<number>();
  const schedule = matches
    .filter((match) => isCalendarMatchInWindow(match, startsAt, endsAt))
    .filter((match) => {
      if (seen.has(match.id)) return false;
      seen.add(match.id);
      return true;
    })
    .slice(0, MAX_PERSONAL_CALENDAR_MATCHES)
    .map(calendarMatchProjection);

  return { matches: schedule, window: { startsAt, endsAt } };
}

export function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

export function formatIcsUtc(unixSeconds: number) {
  const date = new Date(Math.trunc(unixSeconds) * 1000);
  if (Number.isNaN(date.getTime())) throw new RangeError("Invalid ICS timestamp.");
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

const encoder = new TextEncoder();

// RFC 5545 limits physical content lines to 75 octets. Iterate by code point
// so a UTF-8 character is never split across a folded line.
export function foldIcsLine(line: string) {
  const segments: string[] = [];
  let segment = "";
  let bytes = 0;
  let byteLimit = 75;
  for (const character of line) {
    const characterBytes = encoder.encode(character).length;
    if (bytes && bytes + characterBytes > byteLimit) {
      segments.push(segment);
      segment = " ";
      bytes = 1;
      byteLimit = 75;
    }
    segment += character;
    bytes += characterBytes;
  }
  segments.push(segment);
  return segments.join("\r\n");
}

export function serializeMatchCalendarIcs(matches: CalendarMatch[], generatedAtSec: number) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Esports Community Bot//Match Calendar//EN",
    "CALSCALE:GREGORIAN",
  ];
  const stamp = formatIcsUtc(generatedAtSec);
  for (const match of matches) {
    const summary = `${text(match.teamA) || "TBD"} vs ${text(match.teamB) || "TBD"}`;
    const description = [
      match.tournamentName ? `Tournament: ${text(match.tournamentName)}` : "",
      match.game ? `Game: ${text(match.game)}` : "",
    ].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:match-${match.id}@esports-community-bot`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${formatIcsUtc(match.scheduledAt)}`,
      `DTEND:${formatIcsUtc(match.scheduledAt + MATCH_CALENDAR_EVENT_DURATION_SECONDS)}`,
      `SUMMARY:${escapeIcsText(summary)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}
