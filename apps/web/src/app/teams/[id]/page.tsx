import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeftIcon,
  Gamepad2Icon,
  MapPinIcon,
  ShieldIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import { DateTime } from "@/components/date-time";
import { PageBreadcrumb } from "@/components/page-breadcrumb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { gameTitleForSlug, listGamesCached } from "@/lib/games";
import {
  copy,
  formatNumber,
  localizedPath,
  type Locale,
} from "@/lib/i18n";
import { buildPageMetadata } from "@/lib/metadata";
import {
  getTeamPlayersCached,
  getTeamProfileCached,
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

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}

function imageBox({
  imageUrl,
  name,
  label,
}: {
  imageUrl: string | null;
  name: string;
  label: string;
}) {
  return imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- PandaScore image URL is stored from the API and validated as http(s)
    <img
      src={imageUrl}
      alt={name}
      className="size-24 rounded-2xl border border-border bg-muted object-contain p-3"
    />
  ) : (
    <div
      aria-label={label}
      className="flex size-24 items-center justify-center rounded-2xl border border-border bg-muted text-2xl font-semibold text-muted-foreground"
    >
      {initials(name)}
    </div>
  );
}

function profileMeta(
  label: string,
  value: string | null | undefined,
  icon: ReactNode,
) {
  if (!value) return null;
  return (
    <Badge variant="secondary" className="gap-1.5">
      {icon}
      <span>{label}:</span>
      <span dir="auto">{value}</span>
    </Badge>
  );
}

function playerHref(player: PlayerProfile, locale: Locale) {
  return localizedPath(`/players/${player.id}`, locale);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (!id) return {};

  const [team, locale] = await Promise.all([getTeamProfileCached(id), getRequestLocale()]);
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
    getTeamProfileCached(id),
    getTeamPlayersCached(id),
    listGamesCached(),
    getRequestLocale(),
  ]);
  if (!team) notFound();

  const common = copy[locale].common;
  const text = copy[locale].profiles;
  const imageUrl = safeUrlOrUndefined(team.image_url) ?? null;
  const gameTitle = gameTitleForSlug(team.game, games, locale);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-8 sm:px-8 sm:py-10">
      <PageBreadcrumb
        items={[
          { label: common.home, href: localizedPath("/", locale) },
          { label: common.games, href: localizedPath("/games", locale) },
          { label: team.name },
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

      <section className="grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
        <Card className="min-h-72">
          <CardHeader className="gap-5 sm:flex sm:flex-row sm:items-start">
            {imageBox({ imageUrl, name: team.name, label: text.noImage })}
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">
                  <UsersIcon data-icon="inline-start" />
                  {text.teamProfile}
                </Badge>
                <Badge variant="outline">{text.pandascoreSource}</Badge>
              </div>
              <div>
                <CardTitle dir="auto" className="text-3xl font-semibold leading-tight sm:text-4xl">
                  {team.name}
                </CardTitle>
                {team.slug ? <CardDescription dir="auto">{team.slug}</CardDescription> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {profileMeta(text.game, gameTitle || team.game, <Gamepad2Icon className="size-3.5" />)}
                {profileMeta(text.acronym, team.acronym, <ShieldIcon className="size-3.5" />)}
                {profileMeta(text.nationality, team.nationality, <MapPinIcon className="size-3.5" />)}
                {profileMeta(text.location, team.location, <MapPinIcon className="size-3.5" />)}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Separator />
            <div className="mt-4 flex flex-wrap gap-3 text-sm text-muted-foreground">
              <span>{text.updated}: <DateTime value={team.updated_at} locale={locale} /></span>
              {team.last_seen_at ? (
                <span>{text.lastSeen}: <DateTime value={team.last_seen_at} locale={locale} /></span>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>{text.roster}</CardTitle>
            <CardDescription>
              {formatNumber(players.length, locale)} {text.players}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {players.length ? (
              players.map((player) => (
                <Button
                  key={player.id}
                  render={<Link href={playerHref(player, locale)} />}
                  nativeButton={false}
                  variant="ghost"
                  className="h-auto justify-start px-2 py-2"
                >
                  <UserIcon data-icon="inline-start" />
                  <span className="min-w-0 truncate" dir="auto">{player.name}</span>
                </Button>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{text.noRoster}</p>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
