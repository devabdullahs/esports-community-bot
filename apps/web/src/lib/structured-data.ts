import type { Locale } from "@/lib/i18n";

type BreadcrumbItem = {
  name: string;
  url: string;
};

type MatchEventInput = {
  url: string;
  locale: Locale;
  teamA: string | null;
  teamB: string | null;
  scheduledAt: number | null;
  details: unknown;
  status: "running" | "scheduled" | "finished";
  tournamentName: string;
  tournamentUrl: string;
  game?: string | null;
  description: string;
};

export function localizedTournamentDescription({
  locale,
  name,
  game,
}: {
  locale: Locale;
  name: string;
  game?: string | null;
}) {
  const gameContext = game ? (locale === "ar" ? ` في ${game}` : ` in ${game}`) : "";
  return locale === "ar"
    ? `تابع ${name}${gameContext} مع المباريات المباشرة والمواعيد القادمة والنتائج وجدول الترتيب.`
    : `Follow ${name}${gameContext} with live matches, upcoming fixtures, results, and standings.`;
}

export function localizedMatchDescription({
  locale,
  teamA,
  teamB,
  tournamentName,
  game,
}: {
  locale: Locale;
  teamA: string;
  teamB: string;
  tournamentName: string;
  game?: string | null;
}) {
  const gameContext = game ? ` (${game})` : "";
  return locale === "ar"
    ? `تابع مباراة ${teamA} ضد ${teamB} في ${tournamentName}${gameContext}: الموعد والنتيجة والبث والإحصاءات التفصيلية.`
    : `Follow ${teamA} vs ${teamB} in ${tournamentName}${gameContext}: start time, score, stream, and detailed match statistics.`;
}

export function localizedBreadcrumbLabels(locale: Locale) {
  return locale === "ar"
    ? { home: "الرئيسية", tournaments: "البطولات" }
    : { home: "Home", tournaments: "Tournaments" };
}

export function breadcrumbList(items: BreadcrumbItem[], pageUrl: string) {
  return {
    "@type": "BreadcrumbList",
    "@id": `${pageUrl}#breadcrumb`,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

function realParticipant(value: string | null) {
  const normalized = String(value ?? "").trim();
  return normalized && !/^(?:tbd|lobby|unknown|bye|-+)$/i.test(normalized)
    ? normalized
    : null;
}

export function sportsEvent(input: MatchEventInput) {
  const teamA = realParticipant(input.teamA);
  const teamB = realParticipant(input.teamB);
  if (!teamA || !teamB || !input.details) return null;

  const timestamp = Number(input.scheduledAt);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const startDate = new Date(timestamp * 1000);
  if (!Number.isFinite(startDate.getTime())) return null;

  return {
    "@type": "SportsEvent",
    "@id": `${input.url}#sports-event`,
    name: `${teamA} ${input.locale === "ar" ? "ضد" : "vs"} ${teamB}`,
    url: input.url,
    description: input.description,
    startDate: startDate.toISOString(),
    inLanguage: input.locale,
    ...(input.status === "scheduled"
      ? { eventStatus: "https://schema.org/EventScheduled" }
      : {}),
    ...(input.game ? { sport: input.game } : {}),
    competitor: [teamA, teamB].map((name) => ({ "@type": "Organization", name })),
    superEvent: {
      "@type": "SportsEvent",
      name: input.tournamentName,
      url: input.tournamentUrl,
    },
  };
}

export function structuredDataGraph(nodes: Record<string, unknown>[]) {
  return {
    "@context": "https://schema.org",
    "@graph": nodes,
  };
}

const JSON_SCRIPT_ESCAPES: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

export function serializeStructuredData(data: unknown) {
  const serialized = JSON.stringify(data);
  return (serialized ?? "null").replace(
    /[<>&\u2028\u2029]/g,
    (character) => JSON_SCRIPT_ESCAPES[character],
  );
}
