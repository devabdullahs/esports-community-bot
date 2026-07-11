import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowUpRightIcon,
  CrownIcon,
  SearchIcon,
  ShieldCheckIcon,
  StarIcon,
  TrophyIcon,
  UsersIcon,
} from "lucide-react";
import { EwcClubViewSwitcher } from "@/components/clubs/ewc-club-view-switcher";
import { PageBreadcrumb } from "@/components/page-breadcrumb";
import { ProfileAvatar } from "@/components/profiles/profile-avatar";
import { LiquipediaAttribution } from "@/components/tournaments/liquipedia-attribution";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  countUniqueQualifiedGames,
  filterEwcClubTracker,
  getEwcClubTrackerCached,
  type EwcClubGame,
  type EwcClubTrackerClub,
} from "@/lib/ewc-clubs";
import { CLUB_REGION_IDS, cleanClubRegion, type ClubRegionId } from "@/lib/ewc-club-regions";
import { copy, formatDateTime, formatNumber, localizedPath, type Locale } from "@/lib/i18n";
import { buildPageMetadata } from "@/lib/metadata";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Scope = "featured" | "all";

function cleanScope(value: string | string[] | undefined): Scope {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "all" ? "all" : "featured";
}

function cleanQuery(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function clubsHref(locale: Locale, { region, q, scope }: { region: ClubRegionId; q: string; scope: Scope }) {
  const params = new URLSearchParams();
  if (region !== "gulf") params.set("region", region);
  if (q) params.set("q", q);
  if (scope === "all") params.set("scope", "all");
  const qs = params.toString();
  return `${localizedPath("/clubs", locale)}${qs ? `?${qs}` : ""}`;
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const text = copy[locale].ewcClubs;
  return buildPageMetadata({
    title: text.title,
    description: text.description,
    path: localizedPath("/clubs", locale),
    locale,
  });
}

function StatCard({ label, value, icon: Icon }: { label: string; value: string; icon: typeof UsersIcon }) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted">
          <Icon className="size-4 text-muted-foreground" />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="truncate text-base font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function GameChips({
  games,
  empty,
  max,
  variant = "secondary",
}: {
  games: EwcClubGame[];
  empty: string;
  max?: number | null;
  variant?: "secondary" | "outline";
}) {
  if (!games.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const visible = max == null ? games : games.slice(0, max);
  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((game) => (
        <Badge key={`${game.shortLabel}-${game.status}`} variant={variant}>
          {game.shortLabel}
        </Badge>
      ))}
      {games.length > visible.length ? <Badge variant="outline">+{games.length - visible.length}</Badge> : null}
    </div>
  );
}

function ClubCard({ club, locale }: { club: EwcClubTrackerClub; locale: Locale }) {
  const text = copy[locale].ewcClubs;
  const common = copy[locale].common;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex min-w-0 items-start gap-3">
          <ProfileAvatar
            src={club.logo}
            name={club.name}
            shape="rounded"
            fit="contain"
            className="size-14 shrink-0 border border-border"
          />
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate text-lg" dir="auto">
              {club.name}
            </CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-1.5 pt-1">
              <Badge variant="outline">{text.regions[club.region]}</Badge>
              {club.featured ? <Badge variant="secondary">{text.featuredClub}</Badge> : null}
              {club.supportProgram ? <Badge variant="outline">{text.partnerClub}</Badge> : null}
            </CardDescription>
          </div>
        </div>
        {club.pageUrl ? (
          <CardAction>
            <Button
              render={<a href={club.pageUrl} target="_blank" rel="noopener noreferrer nofollow" />}
              nativeButton={false}
              variant="ghost"
              size="icon-sm"
              aria-label={text.openLiquipedia}
            >
              <ArrowUpRightIcon />
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">{text.currentPoints}</p>
            <p className="text-lg font-semibold">
              {club.points == null ? common.notAvailable : formatNumber(club.points, locale)}
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">{text.championshipRank}</p>
            <p className="text-lg font-semibold">
              {club.rank == null ? common.notAvailable : `#${formatNumber(club.rank, locale)}`}
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">{text.qualifiedGames}</p>
            <p className="text-lg font-semibold">
              {formatNumber(club.qualifiedGames.length, locale)}
              {club.possibleEvents ? (
                <span className="text-sm font-normal text-muted-foreground">
                  {" "}
                  / {formatNumber(club.possibleEvents, locale)}
                </span>
              ) : null}
            </p>
          </div>
        </div>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">{text.eventWins}</h2>
            <Badge variant="outline">{text.winsCount(club.winCount)}</Badge>
          </div>
          {club.wins.length ? (
            <div className="flex flex-wrap gap-1.5">
              {club.wins.map((win) => (
                <Badge key={`${win.game}-${win.event ?? ""}`} variant="secondary">
                  {win.game}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{text.noWins}</p>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">{text.qualifiedGames}</h2>
            <Badge variant="outline">{text.qualifiedCount(club.qualifiedGames.length)}</Badge>
          </div>
          <GameChips games={club.qualifiedGames} empty={text.noQualified} />
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">{text.canStillQualify}</h2>
            <Badge variant="outline">{text.possibleCount(club.possibleGames.length)}</Badge>
          </div>
          <GameChips games={club.possibleGames} empty={text.noPossible} variant="outline" max={6} />
        </section>
      </CardContent>
    </Card>
  );
}

export default async function EwcClubsPage({
  searchParams,
}: {
  searchParams: Promise<{ region?: string | string[]; q?: string | string[]; scope?: string | string[] }>;
}) {
  const [params, locale, data] = await Promise.all([
    searchParams,
    getRequestLocale(),
    getEwcClubTrackerCached(),
  ]);
  const region = cleanClubRegion(Array.isArray(params.region) ? params.region[0] : params.region);
  const scope = cleanScope(params.scope);
  const q = cleanQuery(params.q);
  const clubs = filterEwcClubTracker(data, { region, q, scope });
  const text = copy[locale].ewcClubs;
  const common = copy[locale].common;
  const baseForRegionCounts = data.clubs.filter((club) => scope === "all" || club.featured);
  const regionCounts = new Map<ClubRegionId, number>(
    CLUB_REGION_IDS.map((id) => [
      id,
      id === "all"
        ? baseForRegionCounts.length
        : baseForRegionCounts.filter((club) => club.region === id).length,
    ]),
  );
  const selectedLeader =
    clubs
      .filter((club) => club.points != null)
      .sort((a, b) => (b.points ?? 0) - (a.points ?? 0) || (a.rank ?? 9999) - (b.rank ?? 9999))[0] ?? null;
  const qualifiedGamesCount = countUniqueQualifiedGames(clubs);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8 sm:py-10">
      <PageBreadcrumb
        items={[
          { label: common.home, href: localizedPath("/", locale) },
          { label: text.title },
        ]}
      />

      <EwcClubViewSwitcher locale={locale} active="directory" />

      <section className="relative overflow-hidden rounded-2xl border bg-card/40 p-5 shadow-sm sm:p-6">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
        <div className="flex flex-col gap-5">
          <div className="flex max-w-3xl flex-col gap-2">
            <Badge variant="outline" className="w-fit">
              <ShieldCheckIcon />
              {text.eyebrow}
            </Badge>
            <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">{text.title}</h1>
            <p className="text-sm leading-6 text-muted-foreground sm:text-base">{text.description}</p>
            <p className="text-xs leading-5 text-muted-foreground">
              {text.sourceNote}{" "}
              {data.updatedAt
                ? text.updated(formatDateTime(data.updatedAt, locale))
                : text.awaitingSnapshot}
            </p>
            {data.stale ? (
              <p className="text-xs leading-5 text-muted-foreground">{text.staleNotice}</p>
            ) : null}
          </div>

          <form method="get" action={localizedPath("/clubs", locale)} className="flex max-w-md gap-2">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input name="q" defaultValue={q} placeholder={text.searchPlaceholder} className="h-10 ps-8" />
            </div>
            <input type="hidden" name="region" value={region} />
            {scope === "all" ? <input type="hidden" name="scope" value="all" /> : null}
            <Button type="submit" variant="outline">
              {text.searchAction}
            </Button>
          </form>

          <div className="flex flex-col gap-3">
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {(["featured", "all"] as const).map((value) => (
                <Button
                  key={value}
                  render={<Link href={clubsHref(locale, { region, q, scope: value })} />}
                  nativeButton={false}
                  variant={scope === value ? "default" : "outline"}
                  size="sm"
                  className="shrink-0"
                >
                  {value === "featured" ? <StarIcon data-icon="inline-start" /> : <UsersIcon data-icon="inline-start" />}
                  {value === "featured" ? text.scopeFeatured : text.scopeAll}
                </Button>
              ))}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">{text.scopeHint}</p>
          </div>

          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {CLUB_REGION_IDS.map((id) => (
              <Button
                key={id}
                render={<Link href={clubsHref(locale, { region: id, q, scope })} />}
                nativeButton={false}
                variant={region === id ? "default" : "outline"}
                size="sm"
                className="shrink-0"
              >
                {text.regions[id]}
                <Badge variant={region === id ? "secondary" : "outline"}>
                  {formatNumber(regionCounts.get(id) ?? 0, locale)}
                </Badge>
              </Button>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={text.stats.clubs} value={text.resultCount(clubs.length)} icon={UsersIcon} />
        <StatCard
          label={text.stats.pointsLeader}
          value={
            selectedLeader
              ? `${selectedLeader.name} · ${formatNumber(selectedLeader.points ?? 0, locale)}`
              : common.notAvailable
          }
          icon={CrownIcon}
        />
        <StatCard
          label={text.qualifiedGames}
          value={text.qualifiedCount(qualifiedGamesCount)}
          icon={ShieldCheckIcon}
        />
        <StatCard
          label={text.stats.confirmedWins}
          value={text.winsCount(clubs.reduce((sum, club) => sum + club.winCount, 0))}
          icon={TrophyIcon}
        />
      </div>

      {clubs.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {clubs.map((club) => (
            <ClubCard key={club.name} club={club} locale={locale} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {text.noResults}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-2 text-xs text-muted-foreground">
        <p>
          <a
            href={data.sourceUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="underline underline-offset-2 hover:text-foreground"
          >
            {text.qualifiedGames}
          </a>
          {" · "}
          <a
            href={data.standingsSourceUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="underline underline-offset-2 hover:text-foreground"
          >
            {text.currentPoints}
          </a>
        </p>
      </div>
      <LiquipediaAttribution locale={locale} />
    </main>
  );
}
