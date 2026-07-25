import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageBreadcrumb } from "@/components/page-breadcrumb";
import { LiquipediaAttribution } from "@/components/tournaments/liquipedia-attribution";
import { TournamentDirectory } from "@/components/tournaments/tournament-directory";
import { gameTitleForSlug, listGamesCached } from "@/lib/games";
import { copy, localizedPath } from "@/lib/i18n";
import { buildPageMetadata } from "@/lib/metadata";
import { getRequestLocale } from "@/lib/request-locale";
import { hasNonTrackingQuery, paginatedPath, parsePublicPage } from "@/lib/seo-query";
import {
  filterTournamentDirectory,
  parseTournamentDirectoryFilters,
  serializeTournamentDirectoryFilters,
  sourceLabel,
  type TournamentDirectoryItem,
} from "@/lib/tournament-directory";
import {
  listArchivedTournamentFacets,
  listArchivedTournamentSummaries,
} from "@/lib/tournaments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 12;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const locale = await getRequestLocale();
  const params = await searchParams;
  const page = parsePublicPage(params.page);
  if (page === null) return { robots: { index: false, follow: true } };
  const text = copy[locale].tournaments;
  const ewcOnly = first(params.ewc) === "1";
  const basePath = paginatedPath("/tournaments/archive", locale, page);
  return buildPageMetadata({
    title: ewcOnly ? `${copy[locale].common.ewcTournaments} - ${text.archiveTitle}` : text.archiveTitle,
    description: text.archiveDescription,
    path: ewcOnly ? `${basePath}${basePath.includes("?") ? "&" : "?"}ewc=1` : basePath,
    locale,
    robots: hasNonTrackingQuery(params, new Set(["page", "ewc"]))
      ? { index: false, follow: true }
      : undefined,
  });
}

export default async function TournamentArchivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, locale, games, facets] = await Promise.all([
    searchParams,
    getRequestLocale(),
    listGamesCached(),
    listArchivedTournamentFacets(),
  ]);
  const text = copy[locale].tournaments;
  const common = copy[locale].common;
  const current = parsePublicPage(params.page);
  if (current === null) notFound();

  const allItems = facets.map<TournamentDirectoryItem>((tournament) => {
    const game = tournament.game ?? "other";
    return {
      ...tournament,
      gameTitle: gameTitleForSlug(game, games, locale),
      sourceLabel: sourceLabel(tournament.source),
      featuredMatch: null,
    };
  });
  const filters = parseTournamentDirectoryFilters(params, {
    games: allItems.map((item) => item.game ?? "other"),
    sources: allItems.map((item) => item.source),
  });
  const universe = filters.ewc ? allItems.filter((item) => item.ewc) : allItems;
  const filteredUniverse = filterTournamentDirectory(universe, filters);
  const offset = (current - 1) * PAGE_SIZE;
  const summaries = await listArchivedTournamentSummaries({
    limit: PAGE_SIZE,
    offset,
    ewcOnly: filters.ewc,
    game: filters.game === "all" ? "" : filters.game,
    source: filters.source === "all" ? "" : filters.source,
    query: filters.query,
    status: filters.status,
  });
  if (current > 1 && summaries.length === 0) notFound();

  const directoryItems = summaries.map<TournamentDirectoryItem>((tournament) => {
    const game = tournament.game ?? "other";
    return {
      ...tournament,
      gameTitle: gameTitleForSlug(game, games, locale),
      sourceLabel: sourceLabel(tournament.source),
    };
  });
  const heading = filters.ewc
    ? `${common.ewcTournaments} - ${text.archiveTitle}`
    : text.archiveTitle;
  const total = filteredUniverse.length;
  const hasNext = offset + directoryItems.length < total;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-8 sm:px-8 sm:py-10">
      <PageBreadcrumb
        items={[
          { label: common.home, href: localizedPath("/", locale) },
          {
            label: filters.ewc ? common.ewcTournaments : text.title,
            href: localizedPath(filters.ewc ? "/tournaments/ewc" : "/tournaments", locale),
          },
          { label: text.archiveTitle },
        ]}
      />

      <TournamentDirectory
        locale={locale}
        heading={heading}
        tournaments={directoryItems}
        archiveHref={localizedPath(filters.ewc ? "/tournaments/ewc" : "/tournaments", locale)}
        archived
        filterUniverse={universe}
        serverFiltered
        resultTotal={total}
      />

      {current > 1 || hasNext ? (
        <nav className="grid gap-3 sm:flex sm:items-center sm:justify-between">
          {current > 1 ? (
            <Link
              href={archivePageHref(locale, filters, current - 1)}
              className="rounded-md border px-3 py-2 text-center text-sm font-medium text-primary hover:bg-muted/40"
            >
              {common.newer}
            </Link>
          ) : (
            <span className="hidden sm:block" />
          )}
          {hasNext ? (
            <Link
              href={archivePageHref(locale, filters, current + 1)}
              className="rounded-md border px-3 py-2 text-center text-sm font-medium text-primary hover:bg-muted/40"
            >
              {common.older}
            </Link>
          ) : (
            <span className="hidden sm:block" />
          )}
        </nav>
      ) : null}

      <LiquipediaAttribution locale={locale} />
    </main>
  );
}

function archivePageHref(
  locale: "en" | "ar",
  filters: ReturnType<typeof parseTournamentDirectoryFilters>,
  page: number,
): string {
  const params = serializeTournamentDirectoryFilters(filters);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `${localizedPath("/tournaments/archive", locale)}${query ? `?${query}` : ""}`;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
