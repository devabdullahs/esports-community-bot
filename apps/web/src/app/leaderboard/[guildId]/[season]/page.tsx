import Link from "next/link";
import { ArrowLeftIcon, CrownIcon, TrophyIcon, UsersRoundIcon } from "lucide-react";
import { LeaderboardTable } from "@/components/dashboard/leaderboard-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  copy,
  directionForLocale,
  formatNumber,
  localeFromSearchParams,
  localizedPath,
} from "@/lib/i18n";
import { getPublicEwcLeaderboard } from "@bot/lib/ewcProfileStats.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LeaderboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ guildId: string; season: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { guildId, season } = await params;
  const locale = localeFromSearchParams(await searchParams);
  const text = copy[locale];
  const leaderboard = getPublicEwcLeaderboard({ guildId, season, limit: 100 });
  const topScore = leaderboard.rows[0]?.overallPoints || 0;

  return (
    <main
      lang={locale}
      dir={directionForLocale(locale)}
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8"
    >
      <Button
        render={<Link href={localizedPath("/", locale)} />}
        nativeButton={false}
        variant="ghost"
        className="w-fit"
      >
        <ArrowLeftIcon data-icon="inline-start" className="rtl:rotate-180" />
        {text.leaderboard.back}
      </Button>

      <section className="flex flex-col gap-5 rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
        <div className="flex flex-col items-start gap-3">
          <Badge variant="secondary" className="gap-1.5">
            <TrophyIcon data-icon="inline-start" />
            {text.leaderboard.badge}
          </Badge>
          <div className="flex max-w-3xl flex-col gap-2">
            <h1 className="text-3xl font-semibold tracking-normal text-balance sm:text-4xl">
              {text.leaderboard.title(season)}
            </h1>
            <p className="text-sm leading-6 text-muted-foreground">
              {text.leaderboard.description(leaderboard.total, guildId)}
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryMetric
            icon={UsersRoundIcon}
            label={text.leaderboard.rankedMembers}
            value={formatNumber(leaderboard.total, locale)}
          />
          <SummaryMetric
            icon={CrownIcon}
            label={text.leaderboard.topScore}
            value={formatNumber(topScore, locale)}
          />
          <SummaryMetric
            icon={TrophyIcon}
            label={text.common.season}
            value={season}
          />
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{text.common.publicLeaderboard}</CardTitle>
          <CardDescription>{text.leaderboard.description(leaderboard.total, guildId)}</CardDescription>
        </CardHeader>
        <CardContent>
          <LeaderboardTable rows={leaderboard.rows} locale={locale} />
        </CardContent>
      </Card>
    </main>
  );
}

function SummaryMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof TrophyIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-secondary px-4 py-3">
      <span className="flex size-8 items-center justify-center rounded-md bg-background text-primary ring-1 ring-border">
        <Icon />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-lg font-semibold tabular-nums">{value}</p>
      </div>
    </div>
  );
}
