"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

type AnalyticsTrendPoint = {
  day: string;
  visitors: number;
  sessions: number;
  pageviews: number;
  engagementSeconds: number;
};

export function AnalyticsTrendChart({
  days,
  labels,
}: {
  days: AnalyticsTrendPoint[];
  labels: {
    visitors: string;
    sessions: string;
    pageviews: string;
  };
}) {
  const chartConfig = {
    visitors: {
      label: labels.visitors,
      color: "var(--chart-1)",
    },
    sessions: {
      label: labels.sessions,
      color: "var(--chart-2)",
    },
    pageviews: {
      label: labels.pageviews,
      color: "var(--chart-3)",
    },
  } satisfies ChartConfig;
  const chartData = days.map((day) => ({
    ...day,
    label: day.day.slice(5),
  }));

  return (
    <ChartContainer
      config={chartConfig}
      className="h-[260px] min-h-[220px] w-full"
      initialDimension={{ width: 720, height: 260 }}
    >
      <BarChart
        accessibilityLayer
        data={chartData}
        margin={{ top: 12, right: 12, bottom: 0, left: 0 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          minTickGap={16}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={34}
          allowDecimals={false}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              indicator="dot"
              labelFormatter={(_value, payload) => {
                const day = payload?.[0]?.payload?.day;
                return typeof day === "string" ? day : "";
              }}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="visitors" fill="var(--color-visitors)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="sessions" fill="var(--color-sessions)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="pageviews" fill="var(--color-pageviews)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

