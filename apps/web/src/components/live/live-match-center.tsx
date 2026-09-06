"use client";

import { useQuery } from "@tanstack/react-query";
import {
  CalendarClockIcon,
  RadioIcon,
  RefreshCwIcon,
  TrophyIcon,
} from "lucide-react";
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { MatchRow, ScheduleGroup } from "@/components/esports/match-row";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OfficialTournamentAttribution } from "@/components/tournaments/official-tournament-attribution";
import { copy, localizedPath, type Locale } from "@/lib/i18n";
import type { LiveMatchCenter as LiveMatchCenterData } from "@/lib/live-match-center";

export function LiveMatchCenter({
  initialData,
  locale,
  gameLabels = {},
}: {
  initialData: LiveMatchCenterData;
  locale: Locale;
  gameLabels?: Record<string, string>;
}) {
  const text = copy[locale].tournaments;
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [game, setGame] = useState("all");
  const query = useQuery<LiveMatchCenterData>({
    queryKey: ["live-match-center"],
    queryFn: async () => {
      const response = await fetch("/api/live");
      if (!response.ok) throw new Error("Failed to load live matches");
      return response.json();
    },
    initialData,
    refetchInterval: 75_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const data = query.data ?? initialData;
  const requested = search.get("tab");
  const selectedTab =
    requested && ["live", "upcoming", "results"].includes(requested)
      ? requested
      : data.running.length
        ? "live"
        : "upcoming";
  const games = [
    ...new Set(
      [...data.running, ...data.upcoming, ...data.recentFinished]
        .map((item) => item.game)
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort();
  const sections = [
    { key: "live", label: text.liveNow, items: data.running, icon: RadioIcon },
    {
      key: "upcoming",
      label: text.upcoming,
      items: data.upcoming,
      icon: CalendarClockIcon,
    },
    {
      key: "results",
      label: locale === "ar" ? "النتائج" : "Results",
      items: data.recentFinished,
      icon: TrophyIcon,
    },
  ];
  function changeTab(value: string) {
    const params = new URLSearchParams(search.toString());
    params.set("tab", value);
    router.replace(`${pathname}?${params}`, { scroll: false });
  }
  return (
    <main className="ec-public-page ec-container flex flex-col gap-6 py-7">
      <header className="ec-page-heading">
        <p className="ec-kicker">
          {locale === "ar"
            ? "مباشر · جدول · نتائج"
            : "LIVE · SCHEDULE · RESULTS"}
        </p>
        <h1>{copy[locale].live.title}</h1>
        <p>
          {locale === "ar"
            ? "المواجهات التي تهمك، من صافرة البداية إلى النتيجة النهائية."
            : "Every series in focus, from the opening round to the final score."}
        </p>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <label className="flex items-center gap-3 text-sm">
          {copy[locale].common.games}
          <select
            className="min-h-10 rounded border bg-background px-3 text-sm"
            value={game}
            onChange={(event) => setGame(event.target.value)}
          >
            <option value="all">
              {locale === "ar" ? "كل الألعاب" : "All games"}
            </option>
            {games.map((value) => (
              <option key={value} value={value}>
                {gameLabels[value] ||
                  (
                    {
                      callofduty: "Call of Duty",
                      valorant: "VALORANT",
                      csgo: "Counter-Strike",
                      lol: "League of Legends",
                      rocketleague: "Rocket League",
                      dota2: "Dota 2",
                    } as Record<string, string>
                  )[value] ||
                  value}
              </option>
            ))}
          </select>
        </label>
        <div
          className="flex items-center gap-2 text-xs text-muted-foreground"
          role="status"
        >
          <RadioIcon className="size-3 text-live" />
          {text.liveNow}: {data.running.length}
          <span aria-hidden="true">·</span>
          {locale === "ar" ? "بتوقيت الرياض" : "Riyadh time"} UTC+3
        </div>
      </div>
      {query.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 text-sm text-destructive"
        >
          {locale === "ar"
            ? "تعذّر تحديث المباريات. نعرض آخر بيانات متاحة."
            : "Could not refresh matches. Showing the last available data."}
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            <RefreshCwIcon data-icon="inline-start" />
            {locale === "ar" ? "إعادة المحاولة" : "Retry"}
          </Button>
        </div>
      ) : null}
      <Tabs value={selectedTab} onValueChange={changeTab} className="gap-4">
        <TabsList
          className="ec-match-tabs"
          aria-label={copy[locale].live.tabsLabel}
          variant="line"
        >
          {sections.map(({ key, label, items, icon: Icon }) => (
            <TabsTrigger value={key} key={key}>
              <Icon />
              {label}
              <span className="ms-1 text-xs text-muted-foreground">
                {items.length}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        {sections.map(({ key, items, label }) => {
          const filtered = items.filter(
            (item) => game === "all" || item.game === game,
          );
          return (
            <TabsContent key={key} value={key}>
              <section aria-label={label}>
                {filtered.length ? (
                  key === "upcoming" ? (
                    <ScheduleGroup items={filtered} locale={locale} />
                  ) : (
                    filtered.map((item) => (
                      <MatchRow item={item} key={item.id} locale={locale} />
                    ))
                  )
                ) : (
                  <div className="ec-empty">
                    <p>
                      {key === "live"
                        ? text.noLive
                        : key === "upcoming"
                          ? text.noUpcoming
                          : locale === "ar"
                            ? "لا توجد نتائج لهذا الاختيار."
                            : "No results for this selection."}
                    </p>
                    <p>
                      {locale === "ar"
                        ? "اختر لعبة أخرى أو استعرض البطولات والنتائج السابقة."
                        : "Try another game or explore tournaments and previous results."}
                    </p>
                    <Link
                      href={localizedPath("/tournaments", locale)}
                      className="ec-text-link"
                    >
                      {copy[locale].common.tournaments}
                    </Link>
                  </div>
                )}
              </section>
            </TabsContent>
          );
        })}
      </Tabs>
      {selectedTab !== "results" && data.recentFinished.length ? (
        <section aria-labelledby="live-recent-results">
          <h2 id="live-recent-results" className="mb-3 text-lg font-semibold">
            {copy[locale].live.recentContext}
          </h2>
          {data.recentFinished.slice(0, 3).map((item) => (
            <MatchRow item={item} locale={locale} key={item.id} />
          ))}
        </section>
      ) : null}
      {selectedTab === "results" ? (
        <Link
          href={localizedPath("/tournaments/archive", locale)}
          className="ec-text-link"
        >
          {locale === "ar"
            ? "استعرض أرشيف البطولات لمزيد من النتائج"
            : "Explore the tournament archive for more results"}
        </Link>
      ) : null}
      <OfficialTournamentAttribution value={data.attribution} />
    </main>
  );
}
