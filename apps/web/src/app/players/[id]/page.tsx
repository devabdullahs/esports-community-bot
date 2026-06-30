import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeftIcon,
  CalendarClockIcon,
  Gamepad2Icon,
  MapPinIcon,
  ShieldIcon,
  UserIcon,
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
import { copy, localizedPath } from "@/lib/i18n";
import { buildPageMetadata } from "@/lib/metadata";
import { getPlayerProfileCached } from "@/lib/pandascore-profiles";
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
      className="size-28 rounded-full border border-border bg-muted object-cover"
    />
  ) : (
    <div
      aria-label={label}
      className="flex size-28 items-center justify-center rounded-full border border-border bg-muted text-3xl font-semibold text-muted-foreground"
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
  const gameTitle = gameTitleForSlug(player.game, games, locale);
  const teamName = player.resolved_team_name ?? player.current_team_name;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8 sm:px-8 sm:py-10">
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

      <Card>
        <CardHeader className="gap-5 sm:flex sm:flex-row sm:items-start">
          {imageBox({ imageUrl, name: player.name, label: text.noImage })}
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                <UserIcon data-icon="inline-start" />
                {text.playerProfile}
              </Badge>
              <Badge variant="outline">{text.pandascoreSource}</Badge>
            </div>
            <div>
              <CardTitle dir="auto" className="text-3xl font-semibold leading-tight sm:text-4xl">
                {player.name}
              </CardTitle>
              {player.slug ? <CardDescription dir="auto">{player.slug}</CardDescription> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {profileMeta(text.game, gameTitle || player.game, <Gamepad2Icon className="size-3.5" />)}
              {profileMeta(text.role, player.role, <ShieldIcon className="size-3.5" />)}
              {profileMeta(text.nationality, player.nationality, <MapPinIcon className="size-3.5" />)}
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Separator />
          <section className="grid gap-4 md:grid-cols-2">
            <Card size="sm" className="bg-muted/25">
              <CardHeader>
                <CardTitle>{text.currentTeam}</CardTitle>
                <CardDescription dir="auto">
                  {teamName || text.unknownTeam}
                </CardDescription>
              </CardHeader>
              {player.resolved_team_id ? (
                <CardContent>
                  <Button
                    render={<Link href={localizedPath(`/teams/${player.resolved_team_id}`, locale)} />}
                    nativeButton={false}
                    variant="outline"
                  >
                    <ShieldIcon data-icon="inline-start" />
                    {text.viewTeam}
                  </Button>
                </CardContent>
              ) : null}
            </Card>
            <Card size="sm" className="bg-muted/25">
              <CardHeader>
                <CardTitle>
                  <CalendarClockIcon data-icon="inline-start" />
                  {text.updated}
                </CardTitle>
                <CardDescription>
                  <DateTime value={player.updated_at} locale={locale} />
                </CardDescription>
              </CardHeader>
              {player.last_seen_at ? (
                <CardContent className="text-sm text-muted-foreground">
                  {text.lastSeen}: <DateTime value={player.last_seen_at} locale={locale} />
                </CardContent>
              ) : null}
            </Card>
          </section>
        </CardContent>
      </Card>
    </main>
  );
}
