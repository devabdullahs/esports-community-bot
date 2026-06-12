import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LiquipediaAttribution } from "@/components/tournaments/liquipedia-attribution";
import { TournamentMatchList } from "@/components/tournaments/tournament-match-list";
import { copy, formatNumber, localizedPath } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";
import { safeUrlOrUndefined } from "@/lib/safe-url";
import { getTournamentMatchesCached } from "@/lib/tournaments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TournamentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const locale = await getRequestLocale();
  const text = copy[locale].tournaments;

  const tournamentId = /^\d+$/.test(id) ? Number(id) : NaN;
  if (!Number.isSafeInteger(tournamentId) || tournamentId <= 0) notFound();

  const data = await getTournamentMatchesCached(tournamentId);
  if (!data) notFound();

  const { tournament } = data;
  const sourceUrl = safeUrlOrUndefined(tournament.url);
  const isLive = data.matches.running.length > 0;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-5 py-10 sm:px-8">
      <Button
        render={<Link href={localizedPath("/tournaments", locale)} />}
        nativeButton={false}
        variant="ghost"
        className="w-fit"
      >
        <ArrowLeftIcon data-icon="inline-start" className="rtl:rotate-180" />
        {text.back}
      </Button>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {tournament.game ? (
            <Badge variant="secondary" className="uppercase">
              {tournament.game}
            </Badge>
          ) : null}
          {isLive ? <Badge variant="destructive">{text.live}</Badge> : null}
        </div>
        <h1 className="text-3xl font-semibold leading-tight" dir="auto">
          {tournament.name || `#${formatNumber(tournament.id, locale)}`}
        </h1>
        {sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {text.openSource}
            <ExternalLinkIcon className="size-3.5" />
          </a>
        ) : null}
      </header>

      <TournamentMatchList tournamentId={tournament.id} locale={locale} initialData={data} />

      <LiquipediaAttribution locale={locale} />
    </main>
  );
}
