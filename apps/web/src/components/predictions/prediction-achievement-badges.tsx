"use client";

import {
  AwardIcon,
  CalendarCheckIcon,
  CrosshairIcon,
  FlameIcon,
  MedalIcon,
  TargetIcon,
  TrophyIcon,
  type LucideIcon,
} from "lucide-react";
import { EWC_PREDICTION_ACHIEVEMENTS } from "@bot/lib/ewcPredictionAchievements.js";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { copy, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type AchievementDefinition = {
  id: string;
  labels: Record<Locale, string>;
};

const ACHIEVEMENTS_BY_ID = new Map(
  Object.values(EWC_PREDICTION_ACHIEVEMENTS as Record<string, AchievementDefinition>)
    .map((achievement) => [achievement.id, achievement]),
);

const ACHIEVEMENT_ICONS: Record<string, LucideIcon> = {
  "weekly-winner": TrophyIcon,
  "top-ten": MedalIcon,
  "top-twenty": AwardIcon,
  "perfect-week": TargetIcon,
  "scoring-streak": FlameIcon,
  "game-specialist": CrosshairIcon,
  "consistent-predictor": CalendarCheckIcon,
};

export const MAX_VISIBLE_PREDICTION_ACHIEVEMENTS = 3;

export function splitPredictionAchievementBadges(
  achievementIds: readonly string[] | null | undefined,
  maximumVisible = MAX_VISIBLE_PREDICTION_ACHIEVEMENTS,
) {
  const seen = new Set<string>();
  const achievements = (achievementIds || []).flatMap((id) => {
    if (seen.has(id)) return [];
    seen.add(id);
    const achievement = ACHIEVEMENTS_BY_ID.get(id);
    return achievement ? [achievement] : [];
  });
  const visibleCount = Math.max(0, Math.floor(maximumVisible));
  return {
    visible: achievements.slice(0, visibleCount),
    overflow: achievements.slice(visibleCount),
  };
}

export function PredictionAchievementBadges({
  achievementIds,
  locale,
  showLabels = false,
  className,
}: {
  achievementIds: readonly string[] | null | undefined;
  locale: Locale;
  showLabels?: boolean;
  className?: string;
}) {
  const { visible, overflow } = splitPredictionAchievementBadges(achievementIds);
  const common = copy[locale].common;

  if (!visible.length && !overflow.length) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {visible.map((achievement) => {
        const label = achievement.labels[locale];
        const Icon = ACHIEVEMENT_ICONS[achievement.id] || AwardIcon;
        return (
          <Tooltip key={achievement.id}>
            <TooltipTrigger
              render={<Badge variant="outline" tabIndex={0} aria-label={label} className={showLabels ? "gap-1" : "size-5 px-0"} />}
            >
              <Icon aria-hidden="true" />
              {showLabels ? <span>{label}</span> : <span className="sr-only">{label}</span>}
            </TooltipTrigger>
            <TooltipContent dir={locale === "ar" ? "rtl" : "ltr"}>{label}</TooltipContent>
          </Tooltip>
        );
      })}
      {overflow.length ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Badge
                variant="outline"
                tabIndex={0}
                aria-label={common.moreAchievements(overflow.length)}
                className="h-5 px-1.5 tabular-nums"
              />
            }
          >
            +{overflow.length}
          </TooltipTrigger>
          <TooltipContent dir={locale === "ar" ? "rtl" : "ltr"}>
            <ul className="flex flex-col gap-1">
              {overflow.map((achievement) => <li key={achievement.id}>{achievement.labels[locale]}</li>)}
            </ul>
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
