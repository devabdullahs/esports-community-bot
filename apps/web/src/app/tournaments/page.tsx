import Link from "next/link";
import { ArrowRightIcon, TrophyIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LiquipediaAttribution } from "@/components/tournaments/liquipedia-attribution";
import { copy, formatNumber, localizedPath } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";
import { listTournamentSummariesCached } from "@/lib/tournaments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TournamentsPage() {
  const locale = await getRequestLocale();
  const text = copy[locale].tournaments;
  const tournaments = await listTournamentSummariesCached();

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-5 py-10 sm:px-8">
      <section className="flex max-w-3xl flex-col items-start gap-4">
        <Badge variant="outline">
          <TrophyIcon data-icon="inline-start" />
          {text.eyebrow}
        </Badge>
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">{text.title}</h1>
          <p className="text-sm leading-6 text-muted-foreground sm:text-base">{text.description}</p>
        </div>
      </section>

      {tournaments.length ? (
        <section className="grid gap-4 md:grid-cols-3">
          {tournaments.map((t) => (
            <Card key={t.id} size="sm" className="h-full">
              <CardHeader>
                {t.game ? (
                  <Badge variant="secondary" className="mb-2 w-fit uppercase">
                    {t.game}
                  </Badge>
                ) : null}
                <CardTitle dir="auto">{t.name || `#${formatNumber(t.id, locale)}`}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <dl className="flex flex-col gap-1.5 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">{text.live}</dt>
                    <dd
                      className={
                        t.matchCounts.running > 0
                          ? "font-semibold text-primary tabular-nums"
                          : "tabular-nums text-muted-foreground"
                      }
                    >
                      {formatNumber(t.matchCounts.running, locale)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">{text.upcoming}</dt>
                    <dd className="tabular-nums">{formatNumber(t.matchCounts.scheduled, locale)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">{text.finished}</dt>
                    <dd className="tabular-nums">{formatNumber(t.matchCounts.finished, locale)}</dd>
                  </div>
                </dl>
                <Button
                  render={<Link href={localizedPath(`/tournaments/${t.id}`, locale)} />}
                  nativeButton={false}
                  variant="outline"
                  size="sm"
                  className="mt-auto w-full"
                >
                  {text.viewMatches}
                  <ArrowRightIcon data-icon="inline-end" className="rtl:rotate-180" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">{text.empty}</p>
      )}

      <LiquipediaAttribution locale={locale} />
    </main>
  );
}
