import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, ArrowRightIcon, SearchIcon, UserIcon } from "lucide-react";
import { PageBreadcrumb } from "@/components/page-breadcrumb";
import { ProfileAvatar } from "@/components/profiles/profile-avatar";
import { GameIcon } from "@/components/tournaments/tournament-directory";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { flagEmoji } from "@/lib/country";
import {
  cleanDirectoryQuery,
  cleanGameSlug,
  listPlayersDirectory,
  listTeamGames,
} from "@/lib/entity-directory";
import { gameTitleForSlug, listGamesCached } from "@/lib/games";
import { copy, formatNumber, localizedPath, type Locale } from "@/lib/i18n";
import { buildPageMetadata } from "@/lib/metadata";
import type { PlayerProfile } from "@/lib/pandascore-profiles";
import { getRequestLocale } from "@/lib/request-locale";
import { hasNonTrackingQuery, paginatedPath, parsePublicPage } from "@/lib/seo-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 24;

function directoryHref(locale: Locale, { q, game, page }: { q: string; game: string; page: number }) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (game) params.set("game", game);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return `${localizedPath("/players", locale)}${qs ? `?${qs}` : ""}`;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const locale = await getRequestLocale();
  const params = await searchParams;
  const page = parsePublicPage(params.page, 500);
  if (page === null) return { robots: { index: false, follow: true } };
  const text = copy[locale].profiles;
  return buildPageMetadata({
    title: text.playersDirectoryTitle,
    description: text.playersDirectoryDescription,
    path: paginatedPath("/players", locale, page),
    locale,
    robots: hasNonTrackingQuery(params, new Set(["page"]))
      ? { index: false, follow: true }
      : undefined,
  });
}

function PlayerCard({ player, locale }: { player: PlayerProfile; locale: Locale }) {
  const nationalityFlag = flagEmoji(player.nationality);
  const teamName = player.current_team_name;
  return (
    <Link
      href={localizedPath(`/players/${player.id}`, locale)}
      className="group flex items-center gap-3 rounded-2xl border bg-card/60 p-3 outline-none transition-colors hover:border-primary/40 hover:bg-card focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ProfileAvatar
        src={player.image_url}
        name={player.name}
        shape="circle"
        fit="cover"
        focus="top"
        className="size-12 shrink-0 border border-border"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium" dir="auto">
            {player.name}
          </span>
          {nationalityFlag ? <span aria-hidden>{nationalityFlag}</span> : null}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <GameIcon slug={player.game ?? "other"} />
          {teamName ? (
            <span className="truncate" dir="auto">
              {teamName}
            </span>
          ) : null}
          {player.role ? <span className="shrink-0 uppercase">{player.role}</span> : null}
        </div>
      </div>
      <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
    </Link>
  );
}

export default async function PlayersDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; game?: string | string[]; page?: string | string[] }>;
}) {
  const [params, locale, games, teamGames] = await Promise.all([
    searchParams,
    getRequestLocale(),
    listGamesCached(),
    listTeamGames(),
  ]);
  const text = copy[locale].profiles;
  const common = copy[locale].common;

  const q = cleanDirectoryQuery(params.q);
  const game = cleanGameSlug(params.game);
  const page = parsePublicPage(params.page, 500);
  if (page === null) notFound();
  const { players, total } = await listPlayersDirectory({
    q: q || null,
    game: game || null,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const hasPrev = page > 1;
  const hasNext = page * PAGE_SIZE < total;
  if (page > 1 && players.length === 0) notFound();

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8 sm:py-10">
      <PageBreadcrumb
        items={[
          { label: common.home, href: localizedPath("/", locale) },
          { label: text.playersDirectoryTitle },
        ]}
      />

      <section className="relative overflow-hidden rounded-2xl border bg-card/40 p-5 shadow-sm sm:p-6">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
        <div className="flex flex-col gap-4">
          <div className="flex max-w-3xl flex-col gap-2">
            <Badge variant="outline" className="w-fit gap-1.5 border-primary/35 bg-primary/10 text-primary">
              <UserIcon className="size-3.5" />
              {text.playersDirectoryTitle}
            </Badge>
            <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">{text.playersDirectoryTitle}</h1>
            <p className="text-sm leading-6 text-muted-foreground sm:text-base">
              {text.playersDirectoryDescription}
            </p>
            <Link
              href={localizedPath("/teams", locale)}
              className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {text.viewAllTeams}
              <ArrowRightIcon className="size-3.5 rtl:rotate-180" />
            </Link>
          </div>

          <form method="get" action={localizedPath("/players", locale)} className="flex max-w-md gap-2">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input name="q" defaultValue={q} placeholder={text.searchPlaceholder} className="h-10 ps-8" />
            </div>
            {game ? <input type="hidden" name="game" value={game} /> : null}
            <Button type="submit" variant="outline">
              {text.searchAction}
            </Button>
          </form>

          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            <Button
              render={<Link href={directoryHref(locale, { q, game: "", page: 1 })} />}
              nativeButton={false}
              variant={game ? "outline" : "default"}
              size="sm"
              className="shrink-0"
            >
              {text.allGames}
            </Button>
            {teamGames.map((slug) => (
              <Button
                key={slug}
                render={<Link href={directoryHref(locale, { q, game: slug, page: 1 })} />}
                nativeButton={false}
                variant={game === slug ? "default" : "outline"}
                size="sm"
                className="shrink-0 capitalize"
              >
                <GameIcon slug={slug} />
                {gameTitleForSlug(slug, games, locale) || slug}
              </Button>
            ))}
          </div>
        </div>
      </section>

      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-muted-foreground">{text.resultsCount(total)}</span>
        <span className="text-sm text-muted-foreground">{text.pageLabel(page)}</span>
      </div>

      {players.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {players.map((player) => (
            <PlayerCard key={player.id} player={player} locale={locale} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {text.noResults}
          </CardContent>
        </Card>
      )}

      {hasPrev || hasNext ? (
        <div className="flex items-center justify-between">
          {hasPrev ? (
            <Button
              render={<Link href={directoryHref(locale, { q, game, page: page - 1 })} />}
              nativeButton={false}
              variant="outline"
            >
              <ArrowLeftIcon data-icon="inline-start" className="rtl:rotate-180" />
              {text.prevPage}
            </Button>
          ) : (
            <span />
          )}
          {hasNext ? (
            <Button
              render={<Link href={directoryHref(locale, { q, game, page: page + 1 })} />}
              nativeButton={false}
              variant="outline"
            >
              {text.nextPage}
              <ArrowRightIcon data-icon="inline-end" className="rtl:rotate-180" />
            </Button>
          ) : (
            <span />
          )}
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {formatNumber(total, locale)} · {text.pandascoreSource}
      </p>
    </main>
  );
}
