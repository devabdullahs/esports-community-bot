import { ChartNoAxesColumnIncreasingIcon, TrophyIcon, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { copy, type Locale } from "@/lib/i18n";

export type PredictionComparison = {
  overall: {
    rank: number | null;
    total: number;
    percentile: number | null;
  };
  latestWeek: {
    weekKey: string;
    label: string;
    rank: number | null;
    total: number;
    percentile: number | null;
  } | null;
};

export function PredictionComparisonWidget({ comparison, locale }: { comparison: PredictionComparison; locale: Locale }) {
  const text = copy[locale].profile;
  const latestWeek = comparison.latestWeek;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{text.compareTitle}</CardTitle>
        <CardDescription>{text.compareDescription}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 sm:grid-cols-2">
        <ComparisonResult
          icon={TrophyIcon}
          title={text.compareOverall}
          detail={
            comparison.overall.percentile == null || comparison.overall.rank == null
              ? text.compareOverallUnranked
              : text.compareRanked(comparison.overall.percentile, comparison.overall.rank, comparison.overall.total, locale)
          }
        />
        <ComparisonResult
          icon={ChartNoAxesColumnIncreasingIcon}
          title={latestWeek?.label || text.compareLatestWeek}
          detail={
            !latestWeek
              ? text.compareNoWeekly
                : latestWeek.percentile == null || latestWeek.rank == null
                ? text.compareWeeklyUnranked(latestWeek.label)
                : text.compareWeeklyRanked(latestWeek.label, latestWeek.percentile, latestWeek.rank, latestWeek.total, locale)
          }
        />
      </CardContent>
    </Card>
  );
}

function ComparisonResult({
  icon: Icon,
  title,
  detail,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}
