import Link from "next/link";
import {
  ArrowRightIcon,
  BadgeCheckIcon,
  type LucideIcon,
  TrophyIcon,
  UserRoundIcon,
} from "lucide-react";
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
import { DEFAULT_SEASON, defaultPublicGuildId } from "@/lib/env";
import {
  copy,
  directionForLocale,
  localeFromSearchParams,
  localizedPath,
} from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const locale = localeFromSearchParams(await searchParams);
  const text = copy[locale];
  const defaultGuildId = defaultPublicGuildId();
  const leaderboardHref = defaultGuildId
    ? localizedPath(`/leaderboard/${defaultGuildId}/${DEFAULT_SEASON}`, locale)
    : null;
  const profileHref = localizedPath("/me", locale);

  return (
    <main lang={locale} dir={directionForLocale(locale)} className="flex-1">
      <section className="mx-auto grid max-w-6xl gap-10 px-5 py-12 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-start lg:py-16">
        <div className="flex flex-col gap-8">
          <div className="flex flex-col items-start gap-5">
            <Badge variant="outline">{text.home.eyebrow}</Badge>
            <div className="flex max-w-3xl flex-col gap-5">
              <h1 className="text-4xl font-semibold leading-tight text-balance sm:text-5xl">
                {text.home.title}
              </h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                {text.home.description}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              render={<Link href={profileHref} />}
              nativeButton={false}
              size="lg"
            >
              <UserRoundIcon data-icon="inline-start" />
              {text.home.openProfile}
              <ArrowRightIcon
                data-icon="inline-end"
                className="rtl:rotate-180"
              />
            </Button>
            {leaderboardHref ? (
              <Button
                render={<Link href={leaderboardHref} />}
                nativeButton={false}
                size="lg"
                variant="outline"
              >
                <TrophyIcon data-icon="inline-start" />
                {text.home.openLeaderboard}
              </Button>
            ) : null}
          </div>
        </div>

        <Card>
          <CardHeader>
            <Badge variant="secondary" className="mb-2 w-fit">
              {text.home.scoreboardLabel}
            </Badge>
            <CardTitle>{text.home.previewTitle}</CardTitle>
            <CardDescription>{text.home.previewDescription}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col">
            {text.home.scoreboardRows.map(([label, description], index) => (
              <div key={label}>
                {index > 0 ? <Separator /> : null}
                <div className="grid gap-1 py-4 sm:grid-cols-[10rem_1fr] sm:gap-4">
                  <p className="font-medium">{label}</p>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {description}
                  </p>
                </div>
              </div>
            ))}
            <Separator />
            <div className="flex flex-col gap-2 py-4">
              <p className="text-sm text-muted-foreground">
                {text.common.publicLeaderboard}
              </p>
              <p className="font-mono text-sm" dir="ltr">
                {text.home.previewName} | {text.home.previewTeams}
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-10 sm:px-8">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold leading-tight">
              {text.home.featureTitle}
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {text.home.featureDescription}
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <ActionCard
              icon={UserRoundIcon}
              title={text.home.profileTitle}
              description={text.home.profileDescription}
              href={profileHref}
              action={text.home.openProfile}
            />
            <ActionCard
              icon={TrophyIcon}
              title={text.home.leaderboardTitle}
              description={
                leaderboardHref
                  ? text.home.leaderboardDescription
                  : `${text.home.leaderboardDescription} ${text.home.noDefaultLeaderboard}`
              }
              href={leaderboardHref}
              action={text.home.openLeaderboard}
            />
            <ActionCard
              icon={BadgeCheckIcon}
              title={text.home.discordTitle}
              description={text.home.discordDescription}
              href={profileHref}
              action={text.common.myProfile}
            />
          </div>
        </div>
      </section>
    </main>
  );
}

function ActionCard({
  icon: Icon,
  title,
  description,
  href,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string | null;
  action: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="mb-2 flex size-8 items-center justify-center rounded-md border bg-muted">
          <Icon />
        </div>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {href ? (
          <Button
            render={<Link href={href} />}
            nativeButton={false}
            variant="outline"
            size="sm"
          >
            {action}
            <ArrowRightIcon data-icon="inline-end" className="rtl:rotate-180" />
          </Button>
        ) : (
          <Badge variant="outline">/leaderboard/server_id/2026</Badge>
        )}
      </CardContent>
    </Card>
  );
}
