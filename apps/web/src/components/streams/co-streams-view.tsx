"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLinkIcon, RadioIcon, UsersIcon } from "lucide-react";
import type { CoStream, StreamPlatform } from "@/lib/stream-types";
import type { Locale } from "@/lib/i18n";
import { StreamEmbed } from "@/components/streams/stream-embed";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PLATFORM_LABELS: Record<StreamPlatform, string> = {
  twitch: "Twitch",
  kick: "Kick",
  youtube: "YouTube",
  soop: "SOOP",
};
const EMBEDDABLE = new Set<StreamPlatform>(["twitch", "kick"]);

const STR = {
  en: {
    subtitle: "Official Esports World Cup co-streamers. Live channels show first.",
    liveNow: (n: number) => `${n} live now`,
    none: "No co-streamers are live right now.",
    noneFiltered: "No channels match these filters.",
    watching: "watching",
    offline: "Offline",
    allPlatforms: "All platforms",
    allGames: "All games",
    liveOnly: "Live only",
    pick: "Pick a live channel below to watch it here.",
    openOn: (p: string) => `Open on ${p}`,
  },
  ar: {
    subtitle: "المذيعون المصاحبون الرسميون لكأس العالم للرياضات الإلكترونية. القنوات المباشرة تظهر أولاً.",
    liveNow: (n: number) => `${n} مباشر الآن`,
    none: "لا يوجد بث مصاحب مباشر الآن.",
    noneFiltered: "لا توجد قنوات مطابقة لهذه عوامل التصفية.",
    watching: "مشاهد",
    offline: "غير متصل",
    allPlatforms: "كل المنصات",
    allGames: "كل الألعاب",
    liveOnly: "المباشر فقط",
    pick: "اختر قناة مباشرة بالأسفل لمشاهدتها هنا.",
    openOn: (p: string) => `افتح على ${p}`,
  },
} as const;

function cap(slug: string) {
  return slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : slug;
}

export function CoStreamsView({
  streams,
  parent,
  locale,
}: {
  streams: CoStream[];
  parent: string;
  locale: Locale;
}) {
  const router = useRouter();
  const t = STR[locale] ?? STR.en;
  const [platform, setPlatform] = useState<"all" | StreamPlatform>("all");
  const [game, setGame] = useState("all");
  const [liveOnly, setLiveOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Keep live status fresh without a manual reload (the poller writes every ~60s).
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 60_000);
    return () => clearInterval(id);
  }, [router]);

  const liveCount = streams.filter((s) => s.isLive).length;
  const platforms = useMemo(
    () => [...new Set(streams.map((s) => s.platform))] as StreamPlatform[],
    [streams],
  );
  const games = useMemo(
    () => [...new Set(streams.map((s) => s.gameSlug).filter((g): g is string => Boolean(g)))],
    [streams],
  );

  const filtered = useMemo(
    () =>
      streams.filter(
        (s) =>
          (platform === "all" || s.platform === platform) &&
          (game === "all" || s.gameSlug === game) &&
          (!liveOnly || s.isLive),
      ),
    [streams, platform, game, liveOnly],
  );

  // Watch target: the chosen live+embeddable channel, else the first live one.
  const selected = useMemo(() => {
    const chosen =
      selectedId != null
        ? streams.find((s) => s.id === selectedId && s.isLive && EMBEDDABLE.has(s.platform))
        : null;
    return chosen ?? streams.find((s) => s.isLive && EMBEDDABLE.has(s.platform)) ?? null;
  }, [streams, selectedId]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-5 py-10 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{locale === "ar" ? "البث المصاحب" : "Co-streams"}</p>
          <h1 className="text-3xl font-semibold leading-tight">EWC</h1>
          <p className="mt-2 max-w-prose text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
        <Badge variant={liveCount ? "default" : "secondary"} className="gap-1.5">
          <RadioIcon className="size-3.5" />
          {t.liveNow(liveCount)}
        </Badge>
      </div>

      {selected ? (
        <div className="flex flex-col gap-2">
          <StreamEmbed platform={selected.platform} handle={selected.handle} parent={parent} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{PLATFORM_LABELS[selected.platform]}</Badge>
              <span className="font-medium">{selected.label}</span>
              {selected.viewerCount != null ? (
                <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                  <UsersIcon className="size-3.5" />
                  {selected.viewerCount.toLocaleString()} {t.watching}
                </span>
              ) : null}
            </div>
            {selected.url ? (
              <Button render={<a href={selected.url} target="_blank" rel="noreferrer" />} nativeButton={false} variant="ghost" size="sm">
                {t.openOn(PLATFORM_LABELS[selected.platform])}
                <ExternalLinkIcon data-icon="inline-end" />
              </Button>
            ) : null}
          </div>
          {selected.liveTitle ? <p className="text-sm text-muted-foreground">{selected.liveTitle}</p> : null}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <RadioIcon className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">{t.none}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {platforms.length > 1 ? (
          <Select value={platform} onValueChange={(v) => setPlatform((v as "all" | StreamPlatform) ?? "all")}>
            <SelectTrigger size="sm" className="w-36">
              <SelectValue>{(v) => (v === "all" ? t.allPlatforms : PLATFORM_LABELS[v as StreamPlatform])}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">{t.allPlatforms}</SelectItem>
                {platforms.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PLATFORM_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}
        {games.length ? (
          <Select value={game} onValueChange={(v) => setGame(v ?? "all")}>
            <SelectTrigger size="sm" className="w-40">
              <SelectValue>{(v) => (v === "all" ? t.allGames : cap(String(v)))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">{t.allGames}</SelectItem>
                {games.map((g) => (
                  <SelectItem key={g} value={g}>
                    {cap(g)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}
        <Button variant={liveOnly ? "default" : "outline"} size="sm" onClick={() => setLiveOnly((v) => !v)}>
          <RadioIcon data-icon="inline-start" />
          {t.liveOnly}
        </Button>
      </div>

      {filtered.length ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => {
            const canWatch = s.isLive && EMBEDDABLE.has(s.platform);
            const active = selected?.id === s.id;
            return (
              <div
                key={s.id}
                className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${active ? "border-primary bg-muted/40" : ""} ${canWatch ? "cursor-pointer hover:bg-muted/50" : "opacity-90"}`}
                onClick={canWatch ? () => setSelectedId(s.id) : undefined}
                role={canWatch ? "button" : undefined}
                tabIndex={canWatch ? 0 : undefined}
                onKeyDown={canWatch ? (e) => (e.key === "Enter" || e.key === " ") && setSelectedId(s.id) : undefined}
              >
                <div className="flex flex-1 flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{s.label}</span>
                    {s.isLive ? (
                      <Badge variant="default" className="gap-1">
                        <span className="size-1.5 rounded-full bg-current" />
                        LIVE
                      </Badge>
                    ) : (
                      <Badge variant="outline">{t.offline}</Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{PLATFORM_LABELS[s.platform]}</span>
                    {s.gameSlug ? <span>· {cap(s.gameSlug)}</span> : null}
                    {s.language ? <span>· {s.language}</span> : null}
                    {s.isLive && s.viewerCount != null ? (
                      <span className="inline-flex items-center gap-1">
                        · <UsersIcon className="size-3" />
                        {s.viewerCount.toLocaleString()}
                      </span>
                    ) : null}
                  </div>
                </div>
                {s.url ? (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={t.openOn(PLATFORM_LABELS[s.platform])}
                  >
                    <ExternalLinkIcon className="size-4" />
                  </a>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-md border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">{streams.length ? t.noneFiltered : t.none}</p>
        </div>
      )}
    </main>
  );
}
