import Link from "next/link";
import { ArrowLeftIcon, CrownIcon, TrophyIcon, UsersRoundIcon } from "lucide-react";
import { LeaderboardTable } from "@/components/dashboard/leaderboard-table";
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
import {
  copy,
  directionForLocale,
  formatNumber,
  localizedPath,
} from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";
import { getPublicEwcLeaderboard } from "@bot/lib/ewcProfileStats.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LeaderboardPage({
  params,
}: {
  params: Promise<{ guildId: string; season: string }>;
}) {
  const { guildId, season } = await params;
  const locale = await getRequestLocale();
  const text = copy[locale];
  const leaderboard = getPublicEwcLeaderboard({ guildId, season, limit: 100 });
  const topScore = leaderboard.rows[0]?.overallPoints || 0;

  return (
    <main
      lang={locale}
      dir={directionForLocale(locale)}
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-5 py-10 sm:px-8"
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

      <section className="flex flex-col gap-6">
        <div className="flex flex-col items-start gap-4">
          <Badge variant="outline">
            <TrophyIcon data-icon="inline-start" />
            {text.leaderboard.badge}
          </Badge>
          <div className="flex max-w-3xl flex-col gap-3">
            <h1 className="text-3xl font-semibold leading-tight text-balance sm:text-4xl">
              {text.leaderboard.title(season)}
            </h1>
            <p className="text-sm leading-6 text-muted-foreground">
              {text.leaderboard.description(leaderboard.total, guildId)}
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
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
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardAction>
          <Icon className="text-muted-foreground" />
        </CardAction>
        <CardTitle className="truncate text-2xl font-semibold tabular-nums">
          {value}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}
