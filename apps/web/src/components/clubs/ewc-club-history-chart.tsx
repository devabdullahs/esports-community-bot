"use client";

import { TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { EwcClubHistory } from "@/lib/ewc-club-history";
import { copy, directionForLocale, formatNumber, type Locale } from "@/lib/i18n";

type ChartDatum = {
  fetchedAt: string;
  label: string;
  [seriesKey: string]: string | number | undefined;
};

function formatHistoryDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : "en-US", {
    timeZone: "Asia/Riyadh",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function signedNumber(value: number, locale: Locale) {
  return `${value > 0 ? "+" : ""}${formatNumber(value, locale)}`;
}

function chartData(history: EwcClubHistory, locale: Locale) {
  const byFetchedAt = new Map<string, ChartDatum>();
  for (const series of history.series) {
    for (const point of series.points) {
      const datum = byFetchedAt.get(point.fetchedAt) ?? {
        fetchedAt: point.fetchedAt,
        label: formatHistoryDate(point.fetchedAt, locale),
      };
      datum[series.key] = point.points;
      byFetchedAt.set(point.fetchedAt, datum);
    }
  }
  return [...byFetchedAt.values()].sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
}

export function EwcClubHistoryChart({ history, locale }: { history: EwcClubHistory; locale: Locale }) {
  const text = copy[locale].ewcClubStandings.history;
  const data = chartData(history, locale);
  const config = Object.fromEntries(
    history.series.map((series, index) => [
      series.key,
      { label: series.name, color: `var(--chart-${(index % 5) + 1})` },
    ]),
  ) satisfies ChartConfig;

  return (
    <section className="flex min-w-0 flex-col gap-4" dir={directionForLocale(locale)} aria-labelledby="club-history-title">
      <header className="flex min-w-0 flex-col gap-1">
        <h2 id="club-history-title" className="text-lg font-semibold">
          {text.title}
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          {history.selectedClub ? text.selectedClub(history.selectedClub) : text.description}
        </p>
      </header>

      {history.series.length ? (
        <>
          <div className="min-w-0 rounded-lg border bg-card p-4 sm:p-5">
            <div
              role="img"
              aria-label={text.chartLabel}
              data-history-series-count={history.series.length}
            >
              <ChartContainer config={config} className="min-h-[280px] w-full">
                <LineChart
                  accessibilityLayer
                  data={data}
                  margin={{ top: 12, right: 8, bottom: 4, left: 0 }}
                >
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    reversed={locale === "ar"}
                    tickLine={false}
                    tickMargin={8}
                  />
                  <YAxis
                    axisLine={false}
                    tickFormatter={(value) => formatNumber(Number(value), locale)}
                    tickLine={false}
                    tickMargin={8}
                    width={44}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value, name) => (
                          <div className="flex flex-1 justify-between gap-3">
                            <span className="text-muted-foreground">{name}</span>
                            <span className="font-mono font-medium tabular-nums">
                              {formatNumber(Number(value), locale)}
                            </span>
                          </div>
                        )}
                      />
                    }
                  />
                  {history.series.map((series) => (
                    <Line
                      key={series.key}
                      dataKey={series.key}
                      dot={false}
                      name={series.name}
                      stroke={`var(--color-${series.key})`}
                      strokeWidth={2}
                      type="monotone"
                    />
                  ))}
                </LineChart>
              </ChartContainer>
            </div>
          </div>

          {history.movers.length ? (
            <section className="flex min-w-0 flex-col gap-2" aria-labelledby="club-history-movers">
              <h3 id="club-history-movers" className="text-sm font-semibold">
                {text.movers}
              </h3>
              <ul className="flex flex-wrap gap-2">
                {history.movers.map((mover) => (
                  <li key={mover.key}>
                    <Badge variant="outline" className="max-w-full gap-1.5 py-1">
                      {mover.delta < 0 ? <TrendingDownIcon /> : <TrendingUpIcon />}
                      <span className="max-w-36 truncate" dir="auto">
                        {mover.name}
                      </span>
                      <span className="font-mono tabular-nums">{signedNumber(mover.delta, locale)}</span>
                    </Badge>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <details className="min-w-0 rounded-lg border bg-card px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium">{text.tableFallback}</summary>
            <div className="mt-3 max-w-full overflow-x-auto">
              <Table className="min-w-[620px]" aria-label={text.tableFallback}>
                <TableHeader className="bg-muted/60">
                  <TableRow className="hover:bg-muted/60">
                    <TableHead>{text.columns.snapshot}</TableHead>
                    <TableHead>{text.columns.club}</TableHead>
                    <TableHead className="text-center">{text.columns.points}</TableHead>
                    <TableHead className="text-center">{text.columns.change}</TableHead>
                    <TableHead className="text-center">{text.columns.rank}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.series.flatMap((series) =>
                    series.points.map((point) => (
                      <TableRow key={`${series.key}-${point.fetchedAt}`}>
                        <TableCell>
                          <time dateTime={point.fetchedAt}>{formatHistoryDate(point.fetchedAt, locale)}</time>
                        </TableCell>
                        <TableCell dir="auto">{series.name}</TableCell>
                        <TableCell className="text-center font-mono tabular-nums">
                          {formatNumber(point.points, locale)}
                        </TableCell>
                        <TableCell className="text-center font-mono tabular-nums">
                          {point.delta == null ? "-" : signedNumber(point.delta, locale)}
                        </TableCell>
                        <TableCell className="text-center font-mono tabular-nums">
                          {point.rank == null ? "-" : formatNumber(point.rank, locale)}
                        </TableCell>
                      </TableRow>
                    )),
                  )}
                </TableBody>
              </Table>
            </div>
          </details>
        </>
      ) : (
        <Empty className="border border-dashed border-border py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TrendingUpIcon />
            </EmptyMedia>
            <EmptyTitle>{text.emptyTitle}</EmptyTitle>
            <EmptyDescription>{text.emptyDescription}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </section>
  );
}
