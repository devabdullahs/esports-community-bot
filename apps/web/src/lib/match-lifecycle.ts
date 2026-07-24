import type { Locale } from "@/lib/i18n";

export type MatchStatus = "scheduled" | "running" | "finished" | "postponed" | "cancelled";
export type WinnerSide = "team1" | "team2" | "draw" | null;
export type ResultReason = "normal" | "walkover" | "forfeit" | "cancelled" | "postponed" | "unknown";
export type MatchWinner = "a" | "b" | "draw" | null;

export type MatchLifecycleView = {
  status: MatchStatus;
  team_a?: string | null;
  team_b?: string | null;
  score_a?: number | null;
  score_b?: number | null;
  winner_side?: WinnerSide;
  result_reason?: ResultReason;
};

const STATUS_LABELS: Record<Locale, Record<MatchStatus, string>> = {
  en: {
    scheduled: "Scheduled",
    running: "Live now",
    finished: "Finished",
    postponed: "Postponed",
    cancelled: "Cancelled",
  },
  ar: {
    scheduled: "مجدولة",
    running: "مباشر الآن",
    finished: "انتهت",
    postponed: "مؤجلة",
    cancelled: "ملغاة",
  },
};

export function matchStatusLabel(status: MatchStatus, locale: Locale): string {
  return STATUS_LABELS[locale][status];
}

export function matchWinner(match: MatchLifecycleView): MatchWinner {
  if (match.status !== "finished") return null;
  if (match.winner_side === "team1") return "a";
  if (match.winner_side === "team2") return "b";
  if (match.winner_side === "draw") return "draw";
  if (match.score_a == null || match.score_b == null) return null;
  if (match.score_a > match.score_b) return "a";
  if (match.score_b > match.score_a) return "b";
  return "draw";
}

export function matchOutcomeLabel(match: MatchLifecycleView, locale: Locale): string {
  if (match.status !== "finished") return matchStatusLabel(match.status, locale);

  const winner = matchWinner(match);
  if (winner === "draw") return locale === "ar" ? "تعادل" : "Draw";
  if (winner == null) return matchStatusLabel("finished", locale);

  const winnerName = winner === "a" ? match.team_a?.trim() : match.team_b?.trim();
  const fallback = locale === "ar" ? "الفائز" : "Winner";
  const label = winnerName || fallback;

  if (match.result_reason === "walkover") {
    return locale === "ar" ? `فاز ${label} لعدم حضور الخصم` : `${label} won by walkover`;
  }
  if (match.result_reason === "forfeit") {
    return locale === "ar" ? `فاز ${label} لانسحاب الخصم` : `${label} won by forfeit`;
  }
  return locale === "ar" ? `فاز ${label}` : `${label} won`;
}

export function shouldShowOutcomeLabel(match: MatchLifecycleView): boolean {
  return (
    match.status === "postponed"
    || match.status === "cancelled"
    || (
      match.status === "finished"
      && (
        match.score_a == null
        || match.score_b == null
        || match.result_reason === "walkover"
        || match.result_reason === "forfeit"
      )
    )
  );
}
