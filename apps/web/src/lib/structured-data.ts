import type { Locale } from "@/lib/i18n";

type BreadcrumbItem = {
  name: string;
  url: string;
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
