import type { Metadata } from "next";
import Link from "next/link";
import {
  Clock3Icon,
  InfoIcon,
  ListOrderedIcon,
  SearchIcon,
  TrophyIcon,
} from "lucide-react";
import { EwcClubHistoryChart } from "@/components/clubs/ewc-club-history-chart";
import { EwcClubStandingsTable } from "@/components/clubs/ewc-club-standings-table";
import { EwcClubViewSwitcher } from "@/components/clubs/ewc-club-view-switcher";
import { LocalDateTime } from "@/components/local-date-time";
import { PageBreadcrumb } from "@/components/page-breadcrumb";
import { LiquipediaAttribution } from "@/components/tournaments/liquipedia-attribution";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  filterEwcClubStandings,
  getStoredEwcClubStandingsCached,
} from "@/lib/ewc-club-standings";
import {
  cleanEwcClubHistorySelection,
  getEwcClubHistoryCached,
} from "@/lib/ewc-club-history";
import {
  CLUB_REGION_IDS,
  type ClubRegionId,
} from "@/lib/ewc-club-regions";
import { copy, formatNumber, localizedPath, type Locale } from "@/lib/i18n";
import { buildPageMetadata } from "@/lib/metadata";
import { getRequestLocale } from "@/lib/request-locale";
import { hasNonTrackingQuery } from "@/lib/seo-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanQuery(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function cleanRegion(value: string | string[] | undefined): ClubRegionId {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && (CLUB_REGION_IDS as readonly string[]).includes(raw)
    ? (raw as ClubRegionId)
    : "all";
}

function standingsHref(
  locale: Locale,
  { region, q, club }: { region: ClubRegionId; q: string; club: string },
) {
  const params = new URLSearchParams();
  if (region !== "all") params.set("region", region);
  if (q) params.set("q", q);
  if (club) params.set("club", club);
  const query = params.toString();
  return `${localizedPath("/clubs/standings", locale)}${query ? `?${query}` : ""}`;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const locale = await getRequestLocale();
  const params = await searchParams;
  const text = copy[locale].ewcClubStandings;
  return buildPageMetadata({
    title: text.title,
    description: text.description,
    path: localizedPath("/clubs/standings", locale),
    locale,
    robots: hasNonTrackingQuery(params) ? { index: false, follow: true } : undefined,
  });
}

export default async function EwcClubStandingsPage({
  searchParams,
}: {
  searchParams: Promise<{ region?: string | string[]; q?: string | string[]; club?: string | string[] }>;
}) {
  const [params, locale, data] = await Promise.all([
    searchParams,
    getRequestLocale(),
    getStoredEwcClubStandingsCached(),
  ]);
  const region = cleanRegion(params.region);
  const q = cleanQuery(params.q);
  const club = cleanEwcClubHistorySelection(params.club);
  const history = await getEwcClubHistoryCached(data.season, club);
  const rows = filterEwcClubStandings(data.rows, { region, q });
  const text = copy[locale].ewcClubStandings;
  const clubsText = copy[locale].ewcClubs;
  const common = copy[locale].common;
  const regionCounts = new Map<ClubRegionId, number>(
    CLUB_REGION_IDS.map((id) => [
      id,
      id === "all" ? data.rows.length : data.rows.filter((row) => row.region === id).length,
    ]),
  );

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-6xl flex-1 flex-col gap-6 overflow-x-clip px-4 py-8 sm:px-8 sm:py-10">
      <PageBreadcrumb
        items={[
          { label: common.home, href: localizedPath("/", locale) },
          { label: clubsText.title, href: localizedPath("/clubs", locale) },
          { label: text.title },
        ]}
      />

      <EwcClubViewSwitcher locale={locale} active="standings" />

      <header className="flex min-w-0 flex-col gap-4 border-b pb-6">
        <div className="flex max-w-3xl flex-col gap-2">
          <Badge variant="outline" className="w-fit">
            <TrophyIcon />
            {text.eyebrow}
          </Badge>
          <h1 className="text-2xl font-semibold leading-tight sm:text-3xl">{text.title}</h1>
          <p className="text-sm leading-6 text-muted-foreground sm:text-base">{text.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
          <Badge variant="secondary">{text.season(data.season)}</Badge>
          <span>{text.sourceStates[data.dataSource]}</span>
          {data.updatedAt ? (
            <span>
              {text.updated("")} <LocalDateTime value={data.updatedAt} locale={locale} />
            </span>
          ) : null}
          <a
            href={data.sourceUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="underline underline-offset-2 hover:text-foreground"
          >
            {text.sourceLabel}
          </a>
        </div>
      </header>

      {data.stale ? (
        <Alert>
          <Clock3Icon />
          <AlertTitle>{text.staleTitle}</AlertTitle>
          <AlertDescription>{text.staleDescription}</AlertDescription>
        </Alert>
      ) : data.dataSource !== "stored-snapshot" ? (
        <Alert>
          <InfoIcon />
          <AlertTitle>{text.fallbackTitle}</AlertTitle>
          <AlertDescription>{text.fallbackDescription}</AlertDescription>
        </Alert>
      ) : null}

      {data.rows.length ? (
        <>
          <section className="flex min-w-0 flex-col gap-4" aria-label={text.title}>
            <form
              method="get"
              action={localizedPath("/clubs/standings", locale)}
              className="flex w-full max-w-md gap-2"
            >
              <div className="relative flex-1">
                <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  name="q"
                  defaultValue={q}
                  placeholder={text.searchPlaceholder}
                  className="h-10 ps-8"
                />
              </div>
              {region !== "all" ? <input type="hidden" name="region" value={region} /> : null}
              {club ? <input type="hidden" name="club" value={club} /> : null}
              <Button type="submit" variant="outline" className="h-10">
                <SearchIcon data-icon="inline-start" />
                {text.searchAction}
              </Button>
            </form>

            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {CLUB_REGION_IDS.map((id) => (
                <Button
                  key={id}
                  render={<Link href={standingsHref(locale, { region: id, q, club })} />}
                  nativeButton={false}
                  variant={region === id ? "default" : "outline"}
                  size="sm"
                  className="shrink-0"
                >
                  {clubsText.regions[id]}
                  <Badge variant={region === id ? "secondary" : "outline"}>
                    {formatNumber(regionCounts.get(id) ?? 0, locale)}
                  </Badge>
                </Button>
              ))}
            </div>

            <p className="text-xs text-muted-foreground" aria-live="polite">
              {text.resultCount(rows.length)}
            </p>
          </section>

          {rows.length ? (
            <>
              <EwcClubStandingsTable
                rows={rows}
                locale={locale}
                selectedClub={club}
                clubHref={(row) => standingsHref(locale, { region, q, club: row.name })}
              />
              <EwcClubHistoryChart history={history} locale={locale} />
            </>
          ) : (
            <Empty className="border border-dashed border-border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchIcon />
                </EmptyMedia>
                <EmptyTitle>{text.noResults}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
        </>
      ) : (
        <Empty className="border border-dashed border-border py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ListOrderedIcon />
            </EmptyMedia>
            <EmptyTitle>{text.emptyTitle}</EmptyTitle>
            <EmptyDescription>{text.emptyDescription}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <LiquipediaAttribution locale={locale} />
    </main>
  );
}
