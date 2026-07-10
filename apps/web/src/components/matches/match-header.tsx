import { RadioIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { MatchPageModel } from "@/lib/match-details";
import { displayImageUrl } from "@/lib/logo-url";
import { formatUnixSeconds, type Locale } from "@/lib/i18n";

function TeamLogo({ name, url }: { name: string; url: string | null }) {
  if (!url) {
    return (
      <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-muted text-sm font-semibold text-muted-foreground">
        {name.slice(0, 2).toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={displayImageUrl(url)} alt="" className="size-16 shrink-0 rounded-xl object-contain sm:size-20" />
  );
}

export function MatchHeader({ model, locale, liveLabel }: { model: MatchPageModel; locale: Locale; liveLabel: string }) {
  const teamA = model.teamA || "TBD";
  const teamB = model.teamB || "TBD";
  const score = model.scoreA != null && model.scoreB != null ? `${model.scoreA} - ${model.scoreB}` : "-";
  return (
    <header className="relative overflow-hidden rounded-2xl border bg-card/40 p-5 sm:p-8">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
      <div className="flex flex-col items-center gap-5 text-center">
        <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
          {model.tournament.name ? <span>{model.tournament.name}</span> : null}
          {model.status === "running" ? (
            <Badge variant="destructive">
              <RadioIcon data-icon="inline-start" />
              {liveLabel}
            </Badge>
          ) : null}
        </div>
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 sm:gap-6">
          <div className="flex min-w-0 flex-col items-center gap-2" dir="ltr">
            <TeamLogo name={teamA} url={model.logoA} />
            <span className="max-w-full truncate text-sm font-semibold sm:text-base">{teamA}</span>
          </div>
          <span className="text-3xl font-semibold tabular-nums sm:text-5xl" dir="ltr">
            {score}
          </span>
          <div className="flex min-w-0 flex-col items-center gap-2" dir="ltr">
            <TeamLogo name={teamB} url={model.logoB} />
            <span className="max-w-full truncate text-sm font-semibold sm:text-base">{teamB}</span>
          </div>
        </div>
        {model.scheduledAt ? (
          <time className="text-sm text-muted-foreground" dir="ltr">
            {formatUnixSeconds(model.scheduledAt, locale)}
          </time>
        ) : null}
      </div>
    </header>
  );
}
