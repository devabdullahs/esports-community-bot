import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import type { PredictionPickDistribution } from "@/lib/prediction-pick-distribution";

const COPY = {
  en: {
    title: "Community picks",
    noPicks: "No community picks yet",
  },
  ar: {
    title: "\u0627\u062e\u062a\u064a\u0627\u0631\u0627\u062a \u0627\u0644\u0645\u062c\u062a\u0645\u0639",
    noPicks: "\u0644\u0627 \u062a\u0648\u062c\u062f \u0627\u062e\u062a\u064a\u0627\u0631\u0627\u062a \u0628\u0639\u062f",
  },
} as const;

function formatNumber(value: number, locale: "en" | "ar") {
  return new Intl.NumberFormat(locale === "ar" ? "ar" : "en").format(value);
}

function pickCount(value: number, locale: "en" | "ar") {
  const count = formatNumber(value, locale);
  if (locale === "ar") return `${count} ${value === 1 ? "\u0627\u062e\u062a\u064a\u0627\u0631" : "\u0627\u062e\u062a\u064a\u0627\u0631\u0627\u062a"}`;
  return `${count} ${value === 1 ? "pick" : "picks"}`;
}

export function PickDistributionPanel({
  distribution,
  locale,
}: {
  distribution?: PredictionPickDistribution;
  locale: "en" | "ar";
}) {
  if (!distribution?.locked) return null;

  const text = COPY[locale];
  return (
    <section className="flex flex-col gap-4 border-t pt-5" data-pick-distribution dir={locale === "ar" ? "rtl" : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{text.title}</h3>
        <span className="text-sm text-muted-foreground tabular-nums">{pickCount(distribution.totalPicks, locale)}</span>
      </div>
      {distribution.games.length ? (
        distribution.games.map((game) => (
          <div key={game.gameKey} className="flex flex-col gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{game.game}</p>
              {game.event ? <p className="truncate text-xs text-muted-foreground">{game.event}</p> : null}
            </div>
            {game.picks.length ? (
              <div className="flex flex-col gap-3">
                {game.picks.map((pick) => (
                  <Progress key={pick.pick} value={pick.percentage} aria-label={`${pick.pick}: ${pick.percentage}%`}>
                    <ProgressLabel className="min-w-0 truncate">
                      {pick.pick} ({pickCount(pick.count, locale)})
                    </ProgressLabel>
                    <ProgressValue>{`${formatNumber(pick.percentage, locale)}%`}</ProgressValue>
                  </Progress>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{text.noPicks}</p>
            )}
          </div>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">{text.noPicks}</p>
      )}
    </section>
  );
}
