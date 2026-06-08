import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { LeaderboardTable } from "@/components/dashboard/leaderboard-table";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getPublicEwcLeaderboard } from "@bot/lib/ewcProfileStats.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LeaderboardPage({
  params,
}: {
  params: Promise<{ guildId: string; season: string }>;
}) {
  const { guildId, season } = await params;
  const leaderboard = getPublicEwcLeaderboard({ guildId, season, limit: 100 });

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
      <Button render={<Link href="/" />} nativeButton={false} variant="ghost" className="w-fit">
        <ArrowLeftIcon data-icon="inline-start" />
        EWC Predictions
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>EWC {season} prediction leaderboard</CardTitle>
          <CardDescription>
            {leaderboard.total.toLocaleString()} ranked member{leaderboard.total === 1 ? "" : "s"} for server {guildId}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LeaderboardTable rows={leaderboard.rows} />
        </CardContent>
      </Card>
    </main>
  );
}
