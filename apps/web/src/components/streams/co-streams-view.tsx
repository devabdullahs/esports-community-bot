"use client";

import { useEffect, useMemo, useState } from "react";
import { RadioIcon, UsersIcon } from "lucide-react";
import type { CoStream, CoStreamChannel, StreamPlatform } from "@/lib/stream-types";
import { PlatformIcon } from "@/components/platform-icon";
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

const STR = {
  en: {
    eyebrow: "Co-streams",
    subtitle: "Official Esports World Cup co-streamers. Live channels show first.",
    liveNow: (n: number) => `${n} live now`,
    none: "No co-streamers are live right now.",
    noneFiltered: "No co-streamers match these filters.",
    watching: "watching",
    offline: "Offline",
    allPlatforms: "All platforms",
    allGames: "All games",
    liveOnly: "Live only",
    openOn: (p: string) => `Open on ${p}`,
    defaultPlatform: "default",
  },
  ar: {
    eyebrow: "البث المصاحب",
    subtitle: "المذيعون المصاحبون الرسميون لكأس العالم للرياضات الإلكترونية. القنوات المباشرة تظهر أولاً.",
    liveNow: (n: number) => `${n} مباشر الآن`,
    none: "لا يوجد بث مصاحب مباشر الآن.",
    noneFiltered: "لا يوجد مذيعون مطابقون لهذه الفلاتر.",
    watching: "مشاهد",
    offline: "غير متصل",
    allPlatforms: "كل المنصات",
    allGames: "كل الألعاب",
    liveOnly: "المباشر فقط",
    openOn: (p: string) => `افتح على ${p}`,
    defaultPlatform: "الافتراضي",
  },
} as const;

function displaySlug(slug: string) {
  return slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function channelLabel(channel: CoStreamChannel) {
  return PLATFORM_LABELS[channel.platform] ?? channel.platform;
}

export function CoStreamsView({
  streams: initialStreams,
  parent,
  locale,
}: {
  streams: CoStream[];
  parent: string;
  locale: Locale;
}) {
  const t = STR[locale] ?? STR.en;
  const [streams, setStreams] = useState<CoStream[]>(initialStreams);
  const [platform, setPlatform] = useState<"all" | StreamPlatform>("all");
  const [game, setGame] = useState("all");
  const [liveOnly, setLiveOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Keep live status fresh without a full-page reload: poll the JSON endpoint and
  // merge into state, preserving the viewer's filter/selection (the poller writes
  // every ~60s).
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/co-streams", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { streams: CoStream[] };
        if (alive && Array.isArray(data.streams)) setStreams(data.streams);
      } catch {
        /* keep last good data */
      }
    };
    const id = setInterval(tick, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const liveCount = streams.filter((s) => s.isLive).length;
  const platforms = useMemo(() => {
    const set = new Set<StreamPlatform>();
    for (const stream of streams) for (const channel of stream.channels) set.add(channel.platform);
    return [...set];
  }, [streams]);
  const games = useMemo(() => [...new Set(streams.flatMap((s) => s.gameSlugs))], [streams]);

  const filtered = useMemo(
    () =>
      streams.filter(
        (s) =>
          (platform === "all" || s.channels.some((channel) => channel.platform === platform)) &&
          (game === "all" || s.gameSlugs.includes(game)) &&
          (!liveOnly || s.isLive),
      ),
    [streams, platform, game, liveOnly],
  );

  const selected = useMemo(() => {
    const chosen =
      selectedId != null ? streams.find((s) => s.id === selectedId && s.isLive && s.embedChannel) : null;
    return chosen ?? streams.find((s) => s.isLive && s.embedChannel) ?? null;
  }, [streams, selectedId]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-5 py-10 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{t.eyebrow}</p>
          <h1 className="text-3xl font-semibold leading-tight">EWC</h1>
          <p className="mt-2 max-w-prose text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
        <Badge variant={liveCount ? "default" : "secondary"} className="gap-1.5">
          <RadioIcon className="size-3.5" />
          {t.liveNow(liveCount)}
        </Badge>
      </div>

      {selected?.embedChannel ? (
        <div className="flex flex-col gap-2">
          <StreamEmbed platform={selected.embedChannel.platform} handle={selected.embedChannel.handle} parent={parent} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="font-medium">{selected.label}</span>
              {selected.channels.map((channel) => (
                <Badge key={`${channel.platform}:${channel.handle}`} variant={channel.isDefault ? "default" : "secondary"}>
                  {channelLabel(channel)}
                  {channel.isDefault ? <span className="ms-1 opacity-80">· {t.defaultPlatform}</span> : null}
                </Badge>
              ))}
              {selected.viewerCount != null ? (
                <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                  <UsersIcon className="size-3.5" />
                  {selected.viewerCount.toLocaleString()} {t.watching}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-1">
              {selected.channels.map((channel) =>
                channel.url ? (
                  <Button
                    key={`${channel.platform}:${channel.handle}`}
                    render={<a href={channel.url} target="_blank" rel="noreferrer" />}
                    nativeButton={false}
                    variant="ghost"
                    size="sm"
                  >
                    {t.openOn(channelLabel(channel))}
                    <PlatformIcon platform={channel.platform} className="size-4" />
                  </Button>
                ) : null,
              )}
            </div>
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
            <SelectTrigger size="sm" className="w-44">
              <SelectValue>{(v) => (v === "all" ? t.allGames : displaySlug(String(v)))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">{t.allGames}</SelectItem>
                {games.map((g) => (
                  <SelectItem key={g} value={g}>
                    {displaySlug(g)}
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
          {filtered.map((stream) => {
            const canWatch = Boolean(stream.isLive && stream.embedChannel);
            const active = selected?.id === stream.id;
            return (
              <div
                key={stream.id}
                className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                  active ? "border-primary bg-muted/40" : ""
                } ${canWatch ? "cursor-pointer hover:bg-muted/50" : "opacity-90"}`}
                onClick={canWatch ? () => setSelectedId(stream.id) : undefined}
                role={canWatch ? "button" : undefined}
                tabIndex={canWatch ? 0 : undefined}
                onKeyDown={
                  canWatch
                    ? (event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        setSelectedId(stream.id);
                      }
                    : undefined
                }
              >
                <div className="flex flex-1 flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{stream.label}</span>
                    {stream.isLive ? (
                      <Badge variant="default" className="gap-1">
                        <span className="size-1.5 rounded-full bg-current" />
                        LIVE
                      </Badge>
                    ) : (
                      <Badge variant="outline">{t.offline}</Badge>
                    )}
                    {stream.isLive && stream.liveGame ? (
                      <span className="text-xs text-muted-foreground">{stream.liveGame}</span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{stream.channels.map(channelLabel).join(" / ")}</span>
                    {stream.gameSlugs.length ? <span>· {stream.gameSlugs.map(displaySlug).join(", ")}</span> : null}
                    {stream.language ? <span>· {stream.language}</span> : null}
                    {stream.isLive && stream.viewerCount != null ? (
                      <span className="inline-flex items-center gap-1">
                        · <UsersIcon className="size-3" />
                        {stream.viewerCount.toLocaleString()}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex gap-2">
                  {stream.channels.map((channel) =>
                    channel.url ? (
                      <a
                        key={`${channel.platform}:${channel.handle}`}
                        href={channel.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={t.openOn(channelLabel(channel))}
                      >
                        <PlatformIcon platform={channel.platform} className="size-4" />
                      </a>
                    ) : null,
                  )}
                </div>
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
