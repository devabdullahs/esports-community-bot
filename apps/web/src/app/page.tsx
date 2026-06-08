import Link from "next/link";
import {
  ArrowRightIcon,
  BadgeCheckIcon,
  SparklesIcon,
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
import { DEFAULT_SEASON, defaultPublicGuildId } from "@/lib/env";
import {
  copy,
  directionForLocale,
  formatNumber,
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
    <main
      lang={locale}
      dir={directionForLocale(locale)}
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-8 sm:py-10"
    >
      <section className="grid items-stretch gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="flex min-h-[24rem] flex-col justify-between rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
          <div className="flex flex-col items-start gap-5">
            <Badge variant="secondary" className="gap-1.5">
              <SparklesIcon data-icon="inline-start" />
              {text.home.eyebrow}
            </Badge>
            <div className="flex max-w-3xl flex-col gap-4">
              <h1 className="text-4xl font-semibold tracking-normal text-balance sm:text-5xl">
                {text.home.title}
              </h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground text-pretty">
                {text.home.description}
              </p>
            </div>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button render={<Link href={profileHref} />} nativeButton={false} size="lg">
              <UserRoundIcon data-icon="inline-start" />
              {text.home.openProfile}
              <ArrowRightIcon data-icon="inline-end" className="rtl:rotate-180" />
            </Button>
            {leaderboardHref ? (
              <Button render={<Link href={leaderboardHref} />} nativeButton={false} size="lg" variant="outline">
                <TrophyIcon data-icon="inline-start" />
                {text.home.openLeaderboard}
              </Button>
            ) : null}
          </div>
        </div>

        <Card className="min-h-[24rem]">
          <CardHeader>
            <CardTitle>{text.home.previewTitle}</CardTitle>
            <CardDescription>{text.home.previewTeams}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col justify-between gap-6">
            <div className="rounded-lg border bg-muted/35 p-4">
              <p className="text-sm text-muted-foreground">{text.common.rank}</p>
              <p className="mt-2 text-4xl font-semibold text-primary">#2</p>
              <p className="mt-2 text-sm text-muted-foreground">{text.home.previewName}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              <MiniMetric label={text.common.points} value={formatNumber(1240, locale)} />
              <MiniMetric label={text.common.weeks} value={formatNumber(3, locale)} />
              <MiniMetric label={text.common.wins} value={formatNumber(1, locale)} />
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
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
      </section>
    </main>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function ActionCard({
  icon: Icon,
  title,
  description,
  href,
  action,
}: {
  icon: typeof UserRoundIcon;
  title: string;
  description: string;
  href: string | null;
  action: string;
}) {
  return (
    <Card className="transition-[box-shadow] hover:shadow-md hover:ring-1 hover:ring-primary/30">
      <CardHeader>
        <div className="mb-1 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
          <Icon />
        </div>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {href ? (
          <Button render={<Link href={href} />} nativeButton={false} variant="outline">
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
