import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, MapPinIcon, ShieldIcon, UsersIcon } from "lucide-react";
import { DateTime } from "@/components/date-time";
import { FollowButton } from "@/components/follows/follow-button";
import { PageBreadcrumb } from "@/components/page-breadcrumb";
import { LiquipediaAttribution } from "@/components/tournaments/liquipedia-attribution";
import { ProfileAvatar } from "@/components/profiles/profile-avatar";
import { ProfileMatchList } from "@/components/profiles/profile-match-list";
import { GameIcon } from "@/components/tournaments/tournament-directory";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { flagEmoji } from "@/lib/country";
import { getViewerFollowState } from "@/lib/follows";
import { gameTitleForSlug, listGamesCached } from "@/lib/games";
import { copy, formatNumber, localizedPath, type Locale } from "@/lib/i18n";
import { liquipediaTeamDetails } from "@/lib/liquipedia-profile-details";
import { buildPageMetadata } from "@/lib/metadata";
import { getProfileMatchesForTeamNamesCached } from "@/lib/profile-matches";
import {
  getTeamPlayers,
  getTeamProfile,
  type PlayerProfile,
} from "@/lib/pandascore-profiles";
import { getRequestLocale } from "@/lib/request-locale";
import { safeUrlOrUndefined } from "@/lib/safe-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseId(value: string) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border bg-background/40 p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5 truncate text-sm font-medium" dir="auto">
        {children}
      </span>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-b border-border/60 py-2 last:border-b-0 sm:grid-cols-[11rem_minmax(0,1fr)]">
      <dt className="text-xs font-medium uppercase text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm font-medium" dir="auto">
        {value}
      </dd>
    </div>
  );
}

function RosterCard({ player, locale }: { player: PlayerProfile; locale: Locale }) {
  const text = copy[locale].profiles;
  return (
    <Link
      href={localizedPath(`/players/${player.id}`, locale)}
      aria-label={`${text.viewPlayer}: ${player.name}`}
      className="group flex flex-col items-center gap-2.5 rounded-2xl border bg-card/60 p-3 text-center outline-none transition-colors hover:border-primary/40 hover:bg-card focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ProfileAvatar
        src={player.image_url}
        name={player.name}
        shape="circle"
        fit="cover"
        focus="top"
        className="size-16 border border-border sm:size-20"
      />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium" dir="auto">
          {player.name}
        </div>
        {player.role ? (
          <div className="mt-0.5 truncate text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
            {player.role}
          </div>
        ) : null}
      </div>
    </Link>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (!id) return {};

  const [team, locale] = await Promise.all([getTeamProfile(id), getRequestLocale()]);
  if (!team) return {};

  return buildPageMetadata({
    title: team.name,
    description: `${team.name} ${copy[locale].profiles.teamProfile}`,
    path: localizedPath(`/teams/${id}`, locale),
    image: team.image_url,
    locale,
  });
}

export default async function TeamProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (!id) notFound();

  const [team, players, games, locale] = await Promise.all([
    getTeamProfile(id),
    getTeamPlayers(id),
    listGamesCached(),
    getRequestLocale(),
  ]);
  if (!team) notFound();

  const followState = await getViewerFollowState("team", team.name);
  const common = copy[locale].common;
  const text = copy[locale].profiles;
  const imageUrl = safeUrlOrUndefined(team.image_url) ?? null;
  const gameTitle = gameTitleForSlug(team.game, games, locale) || team.game;
  const region = team.location ?? team.nationality;
  const regionFlag = flagEmoji(region);
  const liquipedia = liquipediaTeamDetails(team);
  const sourceLabel = team.liquipedia_parsed_at ? text.profileSourceMixed : text.pandascoreSource;
  const infoRows: { label: string; value: string }[] = [
    { label: text.location, value: liquipedia.location },
    { label: text.region, value: liquipedia.region },
    { label: text.coach, value: liquipedia.coach },
    { label: text.manager, value: liquipedia.manager },
    { label: text.totalWinnings, value: liquipedia.totalWinnings },
  ].flatMap((row) => (row.value ? [{ label: row.label, value: row.value }] : []));
  const hasLiquipediaDetails = Boolean(
    infoRows.length || liquipedia.achievements.length || liquipedia.history.length,
  );
  const trackedMatches = await getProfileMatchesForTeamNamesCached({
    game: team.game,
    names: [team.name, team.acronym, team.slug],
  });

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8 sm:py-10">
      <PageBreadcrumb
        items={[
          { label: common.home, href: localizedPath("/", locale) },
          { label: text.teams, href: localizedPath("/teams", locale) },
          { label: team.name },
        ]}
      />
      <Button
        render={<Link href={localizedPath("/teams", locale)} />}
        nativeButton={false}
        variant="ghost"
        className="w-fit"
      >
        <ArrowLeftIcon data-icon="inline-start" className="rtl:rotate-180" />
        {text.backToTeams}
      </Button>

      <section className="relative overflow-hidden rounded-2xl border bg-card/40 p-5 shadow-sm sm:p-6">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-center gap-4 sm:gap-5">
            <ProfileAvatar
              src={imageUrl}
              name={team.name}
              shape="rounded"
              fit="contain"
              padded={false}
              className="h-20 w-28 shrink-0 border border-border sm:h-24 sm:w-32"
            />
            <div className="flex min-w-0 flex-col gap-2">
              <Badge variant="outline" className="w-fit gap-1.5 border-primary/35 bg-primary/10 text-primary">
                <UsersIcon className="size-3.5" />
                {text.teamProfile}
              </Badge>
              <h1 dir="auto" className="text-3xl font-semibold leading-tight sm:text-4xl">
                {team.name}
              </h1>
              {team.acronym || team.slug ? (
                <p dir="auto" className="text-sm text-muted-foreground">
                  {team.acronym || team.slug}
                </p>
              ) : null}
              <FollowButton
                entityType="team"
                entityKey={team.name}
                entityLabel={team.name}
                entityRef={`/teams/${team.id}`}
                signedIn={followState.signedIn}
                initialFollowing={followState.following}
                locale={locale}
                callbackPath={localizedPath(`/teams/${team.id}`, locale)}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:min-w-[22rem]">
            <Stat label={text.game}>
              <GameIcon slug={team.game ?? "other"} />
              <span className="truncate capitalize">{gameTitle || "—"}</span>
            </Stat>
            <Stat label={text.location}>
              {regionFlag ? <span aria-hidden>{regionFlag}</span> : <MapPinIcon className="size-3.5" />}
              <span className="truncate">{region || "—"}</span>
            </Stat>
            <Stat label={text.players}>
              <UsersIcon className="size-3.5 text-primary" />
              <span>{formatNumber(players.length, locale)}</span>
            </Stat>
          </div>
        </div>
      </section>

      {hasLiquipediaDetails ? (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.85fr)]">
          {infoRows.length ? (
            <div className="rounded-2xl border bg-card/40 p-4 shadow-sm sm:p-5">
              <h2 className="text-base font-semibold">{text.teamInfo}</h2>
              <dl className="mt-3">
                {infoRows.map((row) => (
                  <DetailRow key={row.label} label={row.label} value={row.value} />
                ))}
              </dl>
            </div>
          ) : null}

          {liquipedia.history.length ? (
            <div className="rounded-2xl border bg-card/40 p-4 shadow-sm sm:p-5">
              <h2 className="text-base font-semibold">{text.history}</h2>
              <div className="mt-3 flex flex-col gap-2">
                {liquipedia.history.map((entry, index) => (
                  <div key={`${entry.period}-${entry.team}-${index}`} className="grid gap-1 text-sm sm:grid-cols-[9.5rem_minmax(0,1fr)]">
                    <span className="text-xs italic text-muted-foreground" dir="ltr">
                      {entry.period}
                    </span>
                    <span className="font-medium" dir="auto">
                      {entry.team}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {liquipedia.achievements.length ? (
            <div className="rounded-2xl border bg-card/40 p-4 shadow-sm sm:p-5 lg:col-span-2">
              <h2 className="text-base font-semibold">{text.achievements}</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {liquipedia.achievements.map((achievement, index) => (
                  <span
                    key={`${achievement.title ?? achievement.image ?? "achievement"}-${index}`}
                    className="inline-flex min-h-8 items-center rounded-full border bg-background/50 px-3 py-1 text-sm font-medium"
                    dir="auto"
                  >
                    {achievement.title || text.achievements}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <ProfileMatchList matches={trackedMatches} locale={locale} />

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">{text.roster}</h2>
          <span className="text-sm text-muted-foreground">
            {formatNumber(players.length, locale)} {text.players}
          </span>
        </div>
        {players.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {players.map((player) => (
              <RosterCard key={player.id} player={player} locale={locale} />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              <ShieldIcon className="mx-auto mb-2 size-6 opacity-60" />
              {text.noRoster}
            </CardContent>
          </Card>
        )}
      </section>

      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{sourceLabel}</span>
        <span aria-hidden>·</span>
        <span>
          {text.updated}: <DateTime value={team.updated_at} locale={locale} />
        </span>
        {team.last_seen_at ? (
          <>
            <span aria-hidden>·</span>
            <span>
              {text.lastSeen}: <DateTime value={team.last_seen_at} locale={locale} />
            </span>
          </>
        ) : null}
        {safeUrlOrUndefined(team.liquipedia_url) ? (
          <>
            <span aria-hidden>·</span>
            <a
              href={safeUrlOrUndefined(team.liquipedia_url)}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="underline-offset-4 hover:underline"
            >
              Liquipedia
            </a>
          </>
        ) : null}
      </p>
      {/* CC-BY-SA attribution is required whenever Liquipedia-sourced facts render. */}
      {team.liquipedia_parsed_at ? <LiquipediaAttribution locale={locale} /> : null}
    </main>
  );
}
