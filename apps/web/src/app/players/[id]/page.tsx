import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, ArrowRightIcon, MapPinIcon, ShieldIcon, UserIcon } from "lucide-react";
import { DateTime } from "@/components/date-time";
import { FollowButton } from "@/components/follows/follow-button";
import { PageBreadcrumb } from "@/components/page-breadcrumb";
import { LiquipediaAttribution } from "@/components/tournaments/liquipedia-attribution";
import { ProfileAvatar } from "@/components/profiles/profile-avatar";
import { GameIcon } from "@/components/tournaments/tournament-directory";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { flagEmoji } from "@/lib/country";
import { getViewerFollowState } from "@/lib/follows";
import { gameTitleForSlug, listGamesCached } from "@/lib/games";
import { copy, localizedPath } from "@/lib/i18n";
import { liquipediaPlayerDetails } from "@/lib/liquipedia-profile-details";
import { buildPageMetadata } from "@/lib/metadata";
import { getPlayerProfileCached, type PlayerProfile } from "@/lib/pandascore-profiles";
import { getRequestLocale } from "@/lib/request-locale";
import { safeUrlOrUndefined } from "@/lib/safe-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseId(value: string) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function realName(player: PlayerProfile) {
  const full = [player.first_name, player.last_name].filter(Boolean).join(" ").trim();
  return full && full.toLowerCase() !== player.name.toLowerCase() ? full : null;
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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (!id) return {};

  const [player, locale] = await Promise.all([getPlayerProfileCached(id), getRequestLocale()]);
  if (!player) return {};

  return buildPageMetadata({
    title: player.name,
    description: `${player.name} ${copy[locale].profiles.playerProfile}`,
    path: localizedPath(`/players/${id}`, locale),
    image: player.image_url,
    locale,
  });
}

export default async function PlayerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (!id) notFound();

  const [player, games, locale] = await Promise.all([
    getPlayerProfileCached(id),
    listGamesCached(),
    getRequestLocale(),
  ]);
  if (!player) notFound();

  const followState = await getViewerFollowState("player", String(player.id));
  const common = copy[locale].common;
  const text = copy[locale].profiles;
  const imageUrl = safeUrlOrUndefined(player.image_url) ?? null;
  const gameTitle = gameTitleForSlug(player.game, games, locale) || player.game;
  const liquipedia = liquipediaPlayerDetails(player);
  const teamName = player.resolved_team_name ?? player.current_team_name ?? liquipedia.team;
  const nationalityFlag = flagEmoji(player.nationality);
  const secondaryName = realName(player);
  const statusOrRole = liquipedia.status ?? player.role;
  player.role = statusOrRole;
  const sourceLabel = player.liquipedia_parsed_at ? text.profileSourceMixed : text.pandascoreSource;
  const infoRows: { label: string; value: string }[] = [
    { label: text.romanizedName, value: liquipedia.romanizedName },
    { label: text.status, value: liquipedia.status },
    { label: text.currentTeam, value: liquipedia.team },
    { label: text.totalWinnings, value: liquipedia.totalWinnings },
  ].flatMap((row) => (row.value ? [{ label: row.label, value: row.value }] : []));
  const hasLiquipediaDetails = Boolean(
    infoRows.length || liquipedia.achievements.length || liquipedia.history.length,
  );

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8 sm:py-10">
      <PageBreadcrumb
        items={[
          { label: common.home, href: localizedPath("/", locale) },
          { label: text.players, href: localizedPath("/players", locale) },
          { label: player.name },
        ]}
      />
      <Button
        render={<Link href={localizedPath("/players", locale)} />}
        nativeButton={false}
        variant="ghost"
        className="w-fit"
      >
        <ArrowLeftIcon data-icon="inline-start" className="rtl:rotate-180" />
        {text.backToPlayers}
      </Button>

      <section className="relative overflow-hidden rounded-2xl border bg-card/40 p-5 shadow-sm sm:p-6">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
        <div className="flex min-h-[15rem] flex-col gap-6">
          <div className="flex min-w-0 items-center gap-4 sm:gap-5">
            <ProfileAvatar
              src={imageUrl}
              name={player.name}
              shape="circle"
              fit="cover"
              focus="top"
              className="size-24 shrink-0 border border-border sm:size-28"
            />
            <div className="flex min-w-0 flex-col gap-2">
              <Badge variant="outline" className="w-fit gap-1.5 border-primary/35 bg-primary/10 text-primary">
                <UserIcon className="size-3.5" />
                {text.playerProfile}
              </Badge>
              <h1 dir="auto" className="max-w-full break-normal text-3xl font-semibold leading-tight sm:text-4xl">
                {player.name}
              </h1>
              {secondaryName ? (
                <p dir="auto" className="text-sm text-muted-foreground">
                  {secondaryName}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                <GameIcon slug={player.game ?? "other"} />
                <span className="capitalize" dir="auto">{gameTitle || "—"}</span>
                {player.role ? (
                  <>
                    <span aria-hidden>·</span>
                    <span className="uppercase tracking-wide">{player.role}</span>
                  </>
                ) : null}
              </div>
              <FollowButton
                entityType="player"
                entityKey={String(player.id)}
                entityLabel={player.name}
                entityRef={`/players/${player.id}`}
                signedIn={followState.signedIn}
                initialFollowing={followState.following}
                locale={locale}
                callbackPath={localizedPath(`/players/${player.id}`, locale)}
              />
            </div>
          </div>

          <div className="mt-auto grid w-full grid-cols-1 gap-2 sm:ms-auto sm:w-auto sm:min-w-[30rem] sm:grid-cols-3 md:min-w-[36rem]">
            <Stat label={text.currentTeam}>
              {player.resolved_team_image_url ? (
                <ProfileAvatar
                  src={player.resolved_team_image_url}
                  name={teamName || "?"}
                  shape="rounded"
                  fit="contain"
                  className="size-4 shrink-0"
                />
              ) : (
                <ShieldIcon className="size-3.5" />
              )}
              <span className="truncate">{teamName || text.unknownTeam}</span>
            </Stat>
            <Stat label={liquipedia.status ? text.status : text.role}>
              <ShieldIcon className="size-3.5 text-primary" />
              <span className="truncate uppercase">{player.role || "—"}</span>
            </Stat>
            <Stat label={text.nationality}>
              {nationalityFlag ? <span aria-hidden>{nationalityFlag}</span> : <MapPinIcon className="size-3.5" />}
              <span className="truncate">{player.nationality || "—"}</span>
            </Stat>
          </div>
        </div>
      </section>

      {hasLiquipediaDetails ? (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.85fr)]">
          {infoRows.length ? (
            <div className="rounded-2xl border bg-card/40 p-4 shadow-sm sm:p-5">
              <h2 className="text-base font-semibold">{text.liquipediaInfo}</h2>
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

      {player.resolved_team_id ? (
        <Link
          href={localizedPath(`/teams/${player.resolved_team_id}`, locale)}
          className="group flex items-center gap-4 rounded-2xl border bg-card/40 p-4 outline-none transition-colors hover:border-primary/40 hover:bg-card focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ProfileAvatar
            src={player.resolved_team_image_url}
            name={teamName || "?"}
            shape="rounded"
            fit="contain"
            className="size-12 shrink-0 border border-border"
          />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">{text.currentTeam}</div>
            <div className="truncate text-base font-medium" dir="auto">
              {teamName}
            </div>
          </div>
          <span className="inline-flex items-center gap-1 text-sm text-primary">
            {text.viewTeam}
            <ArrowRightIcon className="size-4 rtl:rotate-180" />
          </span>
        </Link>
      ) : null}

      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{sourceLabel}</span>
        <span aria-hidden>·</span>
        <span>
          {text.updated}: <DateTime value={player.updated_at} locale={locale} />
        </span>
        {player.last_seen_at ? (
          <>
            <span aria-hidden>·</span>
            <span>
              {text.lastSeen}: <DateTime value={player.last_seen_at} locale={locale} />
            </span>
          </>
        ) : null}
        {safeUrlOrUndefined(player.liquipedia_url) ? (
          <>
            <span aria-hidden>·</span>
            <a
              href={safeUrlOrUndefined(player.liquipedia_url)}
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
      {player.liquipedia_parsed_at ? <LiquipediaAttribution locale={locale} /> : null}
    </main>
  );
}
