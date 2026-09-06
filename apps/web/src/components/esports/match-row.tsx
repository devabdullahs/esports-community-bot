import Link from "next/link";
import { CheckIcon, Clock3Icon, RadioIcon } from "lucide-react";
import { ProfileAvatar } from "@/components/profiles/profile-avatar";
import { GameLogoMark } from "@/components/game-logo-mark";
import { copy, formatNumber, localizedPath, type Locale } from "@/lib/i18n";
import type { LiveMatchCenterItem } from "@/lib/live-match-center";
import {
  matchOutcomeLabel,
  matchStatusLabel,
  matchWinner,
  shouldShowOutcomeLabel,
} from "@/lib/match-lifecycle";
import { safeUrlOrUndefined } from "@/lib/safe-url";
import { PlatformIcon } from "@/components/platform-icon";

export function MatchRow({
  item,
  locale,
}: {
  item: LiveMatchCenterItem;
  locale: Locale;
}) {
  const text = copy[locale].tournaments;
  const view = {
    status: item.status,
    team_a: item.teamA,
    team_b: item.teamB,
    score_a: item.scoreA,
    score_b: item.scoreB,
    winner_side: item.winnerSide,
    result_reason: item.resultReason,
  };
  const winner = matchWinner(view);
  const live = item.status === "running";
  const finished = item.status === "finished";
  const streamUrl = safeUrlOrUndefined(item.stream?.url);
  const Icon = live ? RadioIcon : finished ? CheckIcon : Clock3Icon;
  const date = item.scheduledAt ? new Date(item.scheduledAt * 1000) : null;
  const time = date
    ? new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Riyadh",
      }).format(date)
    : text.timeTbd;
  const teams = [
    {
      name: item.teamA || text.tbd,
      logo: item.logoA,
      score: item.scoreA,
      winner: winner === "a",
    },
    {
      name: item.teamB || text.tbd,
      logo: item.logoB,
      score: item.scoreB,
      winner: winner === "b",
    },
  ];
  return (
    <article className="ec-match-row" data-state={item.status}>
      <div className="ec-match-time">
        <span className="ec-match-state">
          <Icon aria-hidden="true" className="size-3" />
          {live
            ? text.liveNow
            : finished
              ? text.finished
              : matchStatusLabel(item.status, locale)}
        </span>
        {date ? (
          <time
            dateTime={date.toISOString()}
            title={new Intl.DateTimeFormat(locale, {
              dateStyle: "medium",
              timeZone: "Asia/Riyadh",
            }).format(date)}
          >
            {time}
          </time>
        ) : (
          <span>{time}</span>
        )}
      </div>
      <Link
        href={localizedPath(item.matchHref, locale)}
        className="ec-match-teams"
        aria-label={`${teams[0].name}${(live || finished) && item.scoreA != null ? ` ${formatNumber(item.scoreA, locale)}` : ""} ${text.vs} ${teams[1].name}${(live || finished) && item.scoreB != null ? ` ${formatNumber(item.scoreB, locale)}` : ""} · ${matchStatusLabel(item.status, locale)}${finished ? ` · ${matchOutcomeLabel(view, locale)}` : ""}`}
      >
        {teams.map((team, index) => (
          <div
            className="ec-team-line"
            key={index}
            data-winner={team.winner || undefined}
          >
            <ProfileAvatar
              src={team.logo}
              name={team.name}
              shape="rounded"
              fit="contain"
              className="size-6 shrink-0"
            />
            <bdi className="ec-team-name">{team.name}</bdi>
            {team.winner ? (
              <CheckIcon
                className="ec-winner-mark size-3"
                aria-label={locale === "ar" ? "الفائز" : "Winner"}
              />
            ) : (
              <span />
            )}
            <span className="ec-team-score">
              {team.score != null && (live || finished)
                ? formatNumber(team.score, locale)
                : "—"}
            </span>
          </div>
        ))}
      </Link>
      <div className="ec-match-context">
        <Link
          href={localizedPath(item.tournamentHref, locale)}
          className="ec-event-link"
        >
          <GameLogoMark
            slug={item.game}
            className="size-6"
            iconClassName="size-4"
          />
          <bdi>{item.tournamentName || text.tbd}</bdi>
        </Link>
        {shouldShowOutcomeLabel(view) ? (
          <bdi className="ec-outcome">{matchOutcomeLabel(view, locale)}</bdi>
        ) : item.name ? (
          <bdi className="ec-round-name">{item.name}</bdi>
        ) : null}
        {live && (streamUrl || item.coStreams.length) ? (
          <div className="ec-match-streams">
            {streamUrl && item.stream ? (
              <a href={streamUrl} target="_blank" rel="noopener noreferrer">
                <PlatformIcon
                  platform={item.stream.platform}
                  className="size-3"
                />
                {text.watchNow}
              </a>
            ) : null}
            {item.coStreams.map((stream) => {
              const url = safeUrlOrUndefined(stream.url);
              return url ? (
                <a
                  key={`${stream.platform}:${stream.handle}`}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <PlatformIcon platform={stream.platform} className="size-3" />
                  <bdi>{stream.label}</bdi>
                </a>
              ) : null;
            })}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function ScheduleGroup({
  items,
  locale,
}: {
  items: LiveMatchCenterItem[];
  locale: Locale;
}) {
  const groups = new Map<string, LiveMatchCenterItem[]>();
  for (const item of items) {
    const day = item.scheduledAt
      ? new Intl.DateTimeFormat(locale, {
          weekday: "long",
          day: "numeric",
          month: "short",
          timeZone: "Asia/Riyadh",
        }).format(item.scheduledAt * 1000)
      : copy[locale].tournaments.timeTbd;
    groups.set(day, [...(groups.get(day) ?? []), item]);
  }
  return (
    <div className="ec-schedule">
      {[...groups].map(([day, matches]) => (
        <section key={day} aria-label={day}>
          <h3 className="ec-schedule-date">
            {day}
            <span>
              {locale === "ar" ? "بتوقيت الرياض" : "Riyadh time"} · UTC+3
            </span>
          </h3>
          {matches.map((item) => (
            <MatchRow key={item.id} item={item} locale={locale} />
          ))}
        </section>
      ))}
    </div>
  );
}
