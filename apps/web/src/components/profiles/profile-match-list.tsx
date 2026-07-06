import Link from "next/link";
import { CalendarDaysIcon, RadioIcon, TrophyIcon } from "lucide-react";
import { DateTime } from "@/components/date-time";
import { PlatformIcon } from "@/components/platform-icon";
import { ProfileAvatar } from "@/components/profiles/profile-avatar";
import { Badge } from "@/components/ui/badge";
import { copy, directionForLocale, localizedPath, type Locale } from "@/lib/i18n";
import type { ProfileMatchRow, ProfileMatches } from "@/lib/profile-matches";

function teamLabel(value: string | null, fallback: string) {
  const trimmed = (value ?? "").trim();
  return trimmed || fallback;
}

function isLobbySchedule(match: ProfileMatchRow) {
  const teamB = teamLabel(match.team_b, "");
  return !teamB || /^lobby$/i.test(teamB) || /^.+:br-schedule:/i.test(match.external_id);
}

function MatchTime({ value, locale, fallback }: { value: number | null; locale: Locale; fallback: string }) {
  if (value == null || !Number.isFinite(value)) return <span>{fallback}</span>;
  return <DateTime value={new Date(value * 1000).toISOString()} locale={locale} />;
}

function ScoreText({ match }: { match: ProfileMatchRow }) {
  if (match.score_a == null || match.score_b == null) return <span className="text-muted-foreground">-</span>;
  return (
    <span className="shrink-0 tabular-nums text-sm font-semibold">
      {match.score_a} <span className="text-muted-foreground">-</span> {match.score_b}
    </span>
  );
}

function MatchTeams({ match, locale, tbd, vs }: { match: ProfileMatchRow; locale: Locale; tbd: string; vs: string }) {
  if (isLobbySchedule(match)) {
    return (
      <span className="min-w-0 truncate text-sm font-medium" dir="auto">
        {match.name || teamLabel(match.team_a, tbd)}
      </span>
    );
  }

  const teamA = teamLabel(match.team_a, tbd);
  const teamB = teamLabel(match.team_b, tbd);
  return (
    <span dir={directionForLocale(locale)} className="flex min-w-0 items-center gap-2 text-start">
      <span className="flex min-w-0 items-center gap-1.5">
        <ProfileAvatar src={match.logo_a} name={teamA} shape="rounded" fit="contain" className="size-7 shrink-0" />
        <bdi className="min-w-0 truncate text-sm font-medium">{teamA}</bdi>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{vs}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <bdi className="min-w-0 truncate text-sm font-medium">{teamB}</bdi>
        <ProfileAvatar src={match.logo_b} name={teamB} shape="rounded" fit="contain" className="size-7 shrink-0" />
      </span>
    </span>
  );
}

function TournamentLink({ match, locale }: { match: ProfileMatchRow; locale: Locale }) {
  return (
    <Link
      href={localizedPath(`/tournaments/${match.tournament_id}`, locale)}
      className="min-w-0 truncate text-xs text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
      dir="auto"
    >
      {match.tournament_name || `#${match.tournament_id}`}
    </Link>
  );
}

function LiveMatchCard({ match, locale }: { match: ProfileMatchRow; locale: Locale }) {
  const text = copy[locale].tournaments;
  return (
    <div className="flex min-w-0 flex-col rounded-xl border bg-background/35">
      <div className="flex min-w-0 items-center justify-between gap-3 p-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <TournamentLink match={match} locale={locale} />
          <MatchTeams match={match} locale={locale} tbd={text.tbd} vs={text.vs} />
        </div>
        <ScoreText match={match} />
      </div>
      {match.stream ? (
        <a
          href={match.stream.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-1.5 border-t px-3 py-1.5 text-xs font-medium text-primary hover:bg-muted/50"
          title={`${text.watchNow} - ${match.stream.platform}`}
        >
          <PlatformIcon platform={match.stream.platform as never} className="size-3.5" />
          {text.watchNow}
        </a>
      ) : null}
    </div>
  );
}

function UpcomingMatchRow({ match, locale }: { match: ProfileMatchRow; locale: Locale }) {
  const text = copy[locale].tournaments;
  return (
    <div className="grid gap-2 border-b border-border/60 py-3 last:border-b-0 md:grid-cols-[10rem_minmax(0,1fr)_minmax(8rem,0.6fr)] md:items-center">
      <div className="text-xs text-muted-foreground tabular-nums">
        <MatchTime value={match.scheduled_at} locale={locale} fallback={text.timeTbd} />
      </div>
      <MatchTeams match={match} locale={locale} tbd={text.tbd} vs={text.vs} />
      <TournamentLink match={match} locale={locale} />
    </div>
  );
}

export function ProfileMatchList({
  matches,
  locale,
}: {
  matches: ProfileMatches;
  locale: Locale;
}) {
  const profileText = copy[locale].profiles;
  const tournamentText = copy[locale].tournaments;
  const hasMatches = matches.running.length > 0 || matches.scheduled.length > 0;
  if (!hasMatches) return null;

  return (
    <section className="flex flex-col gap-4 rounded-2xl border bg-card/40 p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <TrophyIcon className="size-4 text-primary" />
          {profileText.trackedMatches}
        </h2>
        {matches.running.length ? (
          <Badge variant="destructive" className="gap-1.5">
            <RadioIcon className="size-3.5" />
            {tournamentText.live}
          </Badge>
        ) : null}
      </div>

      {matches.running.length ? (
        <div className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-medium">
            <RadioIcon className="size-3.5 text-primary" />
            {tournamentText.liveNow}
          </h3>
          <div className="grid gap-3 lg:grid-cols-2">
            {matches.running.map((match) => (
              <LiveMatchCard key={match.id} match={match} locale={locale} />
            ))}
          </div>
        </div>
      ) : null}

      {matches.scheduled.length ? (
        <div className="flex flex-col gap-1">
          <h3 className="flex items-center gap-1.5 text-sm font-medium">
            <CalendarDaysIcon className="size-3.5 text-primary" />
            {tournamentText.upcoming}
          </h3>
          <div>
            {matches.scheduled.map((match) => (
              <UpcomingMatchRow key={match.id} match={match} locale={locale} />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
