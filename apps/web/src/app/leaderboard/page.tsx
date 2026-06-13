import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon, TrophyIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { currentSeason } from "@/lib/env";
import { resolveDefaultGuildId } from "@/lib/guild";
import { copy, localizedPath } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Auto-routing leaderboard entry point. In a single-guild deployment we can
// resolve "the" guild from the DB, so /leaderboard always works without the
// operator hardcoding a guild id. Only a genuinely empty DB lands on the
// localized empty-state below.
export default async function LeaderboardIndexPage() {
  const guildId = resolveDefaultGuildId();
  const locale = await getRequestLocale();

  if (guildId) {
    redirect(localizedPath(`/leaderboard/${guildId}/${currentSeason()}`, locale));
  }

  const text = copy[locale];

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-5 py-10 sm:px-8">
      <Button
        render={<Link href={localizedPath("/", locale)} />}
        nativeButton={false}
        variant="ghost"
        className="w-fit"
      >
        <ArrowLeftIcon data-icon="inline-start" className="rtl:rotate-180" />
        {text.leaderboard.back}
      </Button>

      <section className="flex flex-col items-start gap-4">
        <Badge variant="outline">
          <TrophyIcon data-icon="inline-start" />
          {text.leaderboard.badge}
        </Badge>
        <Card size="sm" className="w-full">
          <CardHeader>
            <CardTitle>{text.leaderboard.noBoardTitle}</CardTitle>
            <CardDescription>{text.leaderboard.noBoardDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{text.leaderboard.empty}</p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
