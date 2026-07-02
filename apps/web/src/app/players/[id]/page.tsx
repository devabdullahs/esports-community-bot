import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, ArrowRightIcon, MapPinIcon, ShieldIcon, UserIcon } from "lucide-react";
import { DateTime } from "@/components/date-time";
import { PageBreadcrumb } from "@/components/page-breadcrumb";
import { ProfileAvatar } from "@/components/profiles/profile-avatar";
import { GameIcon } from "@/components/tournaments/tournament-directory";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { flagEmoji } from "@/lib/country";
import { gameTitleForSlug, listGamesCached } from "@/lib/games";
import { copy, localizedPath } from "@/lib/i18n";
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

  const common = copy[locale].common;
  const text = copy[locale].profiles;
  const imageUrl = safeUrlOrUndefined(player.image_url) ?? null;
  const gameTitle = gameTitleForSlug(player.game, games, locale) || player.game;
  const teamName = player.resolved_team_name ?? player.current_team_name;
  const nationalityFlag = flagEmoji(player.nationality);
  const secondaryName = realName(player);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8 sm:py-10">
      <PageBreadcrumb
        items={[
          { label: common.home, href: localizedPath("/", locale) },
          { label: common.games, href: localizedPath("/games", locale) },
          { label: player.name },
        ]}
      />
      <Button
        render={<Link href={localizedPath("/games", locale)} />}
        nativeButton={false}
        variant="ghost"
        className="w-fit"
      >
        <ArrowLeftIcon data-icon="inline-start" className="rtl:rotate-180" />
        {text.backToGames}
      </Button>

      <section className="relative overflow-hidden rounded-2xl border bg-card/40 p-5 shadow-sm sm:p-6">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-center gap-4 sm:gap-5">
            <ProfileAvatar
              src={imageUrl}
              name={player.name}
              shape="circle"
              fit="cover"
              className="size-24 shrink-0 border border-border sm:size-28"
            />
            <div className="flex min-w-0 flex-col gap-2">
              <Badge variant="outline" className="w-fit gap-1.5 border-primary/35 bg-primary/10 text-primary">
                <UserIcon className="size-3.5" />
                {text.playerProfile}
              </Badge>
              <h1 dir="auto" className="text-3xl font-semibold leading-tight sm:text-4xl">
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
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:min-w-[22rem]">
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
            <Stat label={text.role}>
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
        <span>{text.pandascoreSource}</span>
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
      </p>
    </main>
  );
}
