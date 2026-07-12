"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ListPlus, Plus, RadioIcon, Share2, UsersIcon, X } from "lucide-react";
import { PlatformIcon } from "@/components/platform-icon";
import { MultiStreamGrid } from "@/components/streams/multi-stream-grid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Locale } from "@/lib/i18n";
import {
  MAX_MULTI_STREAMS,
  initialLoadedStreamIds,
  initialSelectedStreamIds,
  loadedIdsAfterStreamAdded,
  loadedIdsAfterStreamLoad,
  reconcileLoadedStreamIds,
  reconcileSelectedStreamIds,
  streamSelectionSearchParams,
  toggleSelectedStreamId,
} from "@/lib/co-stream-multiview";
import type { CoStream, CoStreamChannel, StreamPlatform } from "@/lib/stream-types";

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
    openOn: (platform: string) => `Open on ${platform}`,
    multiView: "Multiview",
    addStreams: "Add streams",
    selectedCount: (n: number) => `${n} / ${MAX_MULTI_STREAMS} selected`,
    searchStreams: "Search streams",
    removeStream: "Remove stream",
    addStream: "Add stream",
    shareView: "Share view",
    linkCopied: "Link copied",
    enterFullscreen: "Enter fullscreen",
    exitFullscreen: "Exit fullscreen",
    clearAll: "Clear all",
    selectionLimit: `You can select up to ${MAX_MULTI_STREAMS} streams.`,
    loadStream: "Load stream",
    streamEnded: "Stream ended",
    fullscreenFailed: "Fullscreen could not be opened.",
    mobilePlaybackHint: "Mobile browsers allow one active player at a time. Load a stream to switch, then press play in the player.",
  },
  ar: {
    eyebrow: "البث المصاحب",
    subtitle: "المذيعون المصاحبون الرسميون لكأس العالم للرياضات الإلكترونية. تظهر القنوات المباشرة أولاً.",
    liveNow: (n: number) => `${n} مباشر الآن`,
    none: "لا يوجد بث مصاحب مباشر الآن.",
    noneFiltered: "لا يوجد مذيعون مطابقون لهذه الفلاتر.",
    watching: "مشاهد",
    offline: "غير متصل",
    allPlatforms: "كل المنصات",
    allGames: "كل الألعاب",
    liveOnly: "المباشر فقط",
    openOn: (platform: string) => `افتح على ${platform}`,
    multiView: "عرض متعدد",
    addStreams: "إضافة بثوث",
    selectedCount: (n: number) => `${n} / ${MAX_MULTI_STREAMS} محدد`,
    searchStreams: "البحث في البثوث",
    removeStream: "إزالة البث",
    addStream: "إضافة البث",
    shareView: "مشاركة العرض",
    linkCopied: "تم نسخ الرابط",
    enterFullscreen: "دخول ملء الشاشة",
    exitFullscreen: "الخروج من ملء الشاشة",
    clearAll: "مسح الكل",
    selectionLimit: `يمكنك اختيار ${MAX_MULTI_STREAMS} بثوث كحد أقصى.`,
    loadStream: "تحميل البث",
    streamEnded: "انتهى البث",
    fullscreenFailed: "تعذر فتح وضع ملء الشاشة.",
    mobilePlaybackHint: "تسمح متصفحات الجوال بمشغّل نشط واحد في كل مرة. حمّل البث للتبديل، ثم اضغط تشغيل داخل المشغّل.",
  },
} as const;

function displaySlug(slug: string) {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function channelLabel(channel: CoStreamChannel) {
  return PLATFORM_LABELS[channel.platform] ?? channel.platform;
}

function selectionUrl(ids: string[]) {
  const url = new URL(window.location.href);
  url.searchParams.delete("stream");
  for (const [key, value] of streamSelectionSearchParams(ids)) url.searchParams.append(key, value);
  return url;
}

const MOBILE_PLAYER_QUERY = "(max-width: 767px)";

function subscribeMobilePlayer(callback: () => void) {
  const media = window.matchMedia(MOBILE_PLAYER_QUERY);
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", callback);
    return () => media.removeEventListener("change", callback);
  }
  media.addListener(callback);
  return () => media.removeListener(callback);
}

function mobilePlayerSnapshot() {
  return window.matchMedia(MOBILE_PLAYER_QUERY).matches;
}

export function CoStreamsView({
  streams: initialStreams,
  parent,
  locale,
  requestedStreamIds,
  hasExplicitSelection,
}: {
  streams: CoStream[];
  parent: string;
  locale: Locale;
  requestedStreamIds: string[];
  hasExplicitSelection: boolean;
}) {
  const t = STR[locale] ?? STR.en;
  const [streams, setStreams] = useState<CoStream[]>(initialStreams);
  const [platform, setPlatform] = useState<"all" | StreamPlatform>("all");
  const [game, setGame] = useState("all");
  const [liveOnly, setLiveOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() =>
    initialSelectedStreamIds(requestedStreamIds, initialStreams, hasExplicitSelection),
  );
  const [loadedIds, setLoadedIds] = useState(() => initialLoadedStreamIds(selectedIds, initialStreams));
  const [shareStatus, setShareStatus] = useState("");
  const singleMobilePlayer = useSyncExternalStore(subscribeMobilePlayer, mobilePlayerSnapshot, () => false);
  const shareStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didMountSelection = useRef(false);

  const applyPolledStreams = useEffectEvent((nextStreams: CoStream[]) => {
    const nextSelected = reconcileSelectedStreamIds(selectedIds, nextStreams);
    const nextLoaded = reconcileLoadedStreamIds(loadedIds, nextSelected);
    setStreams(nextStreams);
    setSelectedIds(nextSelected);
    setLoadedIds(nextLoaded);
  });

  useEffect(() => {
    if (!didMountSelection.current) {
      didMountSelection.current = true;
      return;
    }
    const url = selectionUrl(selectedIds);
    window.history.replaceState(window.history.state, "", url);
  }, [selectedIds]);

  useEffect(() => {
    return () => {
      if (shareStatusTimer.current) clearTimeout(shareStatusTimer.current);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let controller: AbortController | null = null;

    const tick = async () => {
      if (document.visibilityState !== "visible" || controller) return;
      controller = new AbortController();
      try {
        const res = await fetch("/api/co-streams", { cache: "no-store", signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as { streams: CoStream[] };
        if (!alive || !Array.isArray(data.streams)) return;
        applyPolledStreams(data.streams);
      } catch {
        /* Keep the last good stream data. */
      } finally {
        controller = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void tick();
    };
    const intervalId = window.setInterval(() => void tick(), 60_000);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      alive = false;
      controller?.abort();
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const liveCount = streams.filter((stream) => stream.isLive).length;
  const platforms = useMemo(() => {
    const values = new Set<StreamPlatform>();
    for (const stream of streams) for (const channel of stream.channels) values.add(channel.platform);
    return [...values];
  }, [streams]);
  const games = useMemo(() => [...new Set(streams.flatMap((stream) => stream.gameSlugs))], [streams]);
  const selectedStreams = useMemo(() => {
    const byId = new Map(streams.map((stream) => [stream.id, stream]));
    return selectedIds.map((id) => byId.get(id)).filter((stream): stream is CoStream => Boolean(stream));
  }, [selectedIds, streams]);
  const selectableIds = useMemo(
    () => new Set(streams.filter((stream) => stream.isLive && stream.embedChannel).map((stream) => stream.id)),
    [streams],
  );
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const atLimit = selectedIds.length >= MAX_MULTI_STREAMS;
  const filtered = useMemo(
    () =>
      streams.filter(
        (stream) =>
          (platform === "all" || stream.channels.some((channel) => channel.platform === platform)) &&
          (game === "all" || stream.gameSlugs.includes(game)) &&
          (!liveOnly || stream.isLive),
      ),
    [streams, platform, game, liveOnly],
  );

  const toggleStream = (id: string) => {
    const wasSelected = selectedSet.has(id);
    const result = toggleSelectedStreamId(selectedIds, id, selectableIds);
    if (result.ids === selectedIds || (result.ids.length === selectedIds.length && !wasSelected)) return;
    setSelectedIds(result.ids);
    setLoadedIds((current) =>
      wasSelected
        ? reconcileLoadedStreamIds(current, result.ids)
        : loadedIdsAfterStreamAdded(current, result.ids, id, singleMobilePlayer),
    );
  };

  const removeStream = (id: string) => {
    const next = selectedIds.filter((selectedId) => selectedId !== id);
    setSelectedIds(next);
    setLoadedIds((current) => reconcileLoadedStreamIds(current, next));
  };

  const clearAll = () => {
    setSelectedIds([]);
    setLoadedIds([]);
  };

  const shareView = async () => {
    const url = selectionUrl(selectedIds);
    try {
      await navigator.clipboard.writeText(url.toString());
      setShareStatus(t.linkCopied);
      if (shareStatusTimer.current) clearTimeout(shareStatusTimer.current);
      shareStatusTimer.current = setTimeout(() => setShareStatus(""), 2_500);
    } catch {
      setShareStatus("");
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-[120rem] flex-1 flex-col gap-6 px-4 py-8 sm:px-8 sm:py-10">
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

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{t.selectedCount(selectedIds.length)}</Badge>
        <Sheet>
          <SheetTrigger render={<Button type="button" variant="outline" />}>
            <ListPlus data-icon="inline-start" />
            {t.addStreams}
          </SheetTrigger>
          <SheetContent
            side="bottom"
            className="mx-auto max-h-[85dvh] w-full max-w-3xl gap-0 overflow-hidden rounded-t-lg"
          >
            <SheetHeader className="border-b">
              <SheetTitle>{t.addStreams}</SheetTitle>
              <SheetDescription>{t.multiView}</SheetDescription>
            </SheetHeader>
            <Command className="min-h-0 rounded-none" defaultValue="__multiview_unselected__">
              <CommandInput placeholder={t.searchStreams} aria-label={t.searchStreams} />
              <CommandList className="max-h-none min-h-0 flex-1">
                <CommandEmpty>{t.noneFiltered}</CommandEmpty>
                <CommandGroup>
                  {streams.map((stream) => {
                    const selected = selectedSet.has(stream.id);
                    const canSelect = selectableIds.has(stream.id);
                    const disabled = !selected && (!canSelect || atLimit);
                    const searchable = [
                      stream.label,
                      stream.liveTitle,
                      stream.liveGame,
                      stream.language,
                      ...stream.channels.map(channelLabel),
                    ]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <CommandItem
                        key={stream.id}
                        value={`${stream.id} ${searchable}`}
                        disabled={disabled}
                        data-checked={selected}
                        aria-checked={selected}
                        onSelect={() => toggleStream(stream.id)}
                      >
                        <span className="min-w-0 flex-1 truncate">{stream.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {stream.channels.map(channelLabel).join(" / ")}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
            <SheetFooter className="border-t">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">
                  {selectedIds.length} / {MAX_MULTI_STREAMS}
                </span>
                {selectedIds.length ? (
                  <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
                    <X data-icon="inline-start" />
                    {t.clearAll}
                  </Button>
                ) : null}
              </div>
              {atLimit ? <p className="text-xs text-muted-foreground">{t.selectionLimit}</p> : null}
            </SheetFooter>
          </SheetContent>
        </Sheet>
        <Button type="button" variant="outline" onClick={shareView}>
          <Share2 data-icon="inline-start" />
          {t.shareView}
        </Button>
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {shareStatus}
        </span>
      </div>

      <MultiStreamGrid
        selected={selectedStreams}
        loadedIds={loadedIds}
        parent={parent}
        autoplay={!singleMobilePlayer}
        strings={{
          multiView: t.multiView,
          watching: t.watching,
          loadStream: t.loadStream,
          streamEnded: t.streamEnded,
          removeStream: t.removeStream,
          openOn: t.openOn,
          enterFullscreen: t.enterFullscreen,
          exitFullscreen: t.exitFullscreen,
          fullscreenFailed: t.fullscreenFailed,
        }}
        onLoad={(id) =>
          setLoadedIds((current) => loadedIdsAfterStreamLoad(current, selectedIds, id, singleMobilePlayer))
        }
        onRemove={removeStream}
      />

      {selectedIds.length > 1 ? (
        <p className="text-xs text-muted-foreground md:hidden">{t.mobilePlaybackHint}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {platforms.length > 1 ? (
          <Select value={platform} onValueChange={(value) => setPlatform((value as "all" | StreamPlatform) ?? "all")}>
            <SelectTrigger size="sm" className="w-36">
              <SelectValue>
                {(value) => (value === "all" ? t.allPlatforms : PLATFORM_LABELS[value as StreamPlatform])}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">{t.allPlatforms}</SelectItem>
                {platforms.map((value) => (
                  <SelectItem key={value} value={value}>
                    {PLATFORM_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}
        {games.length ? (
          <Select value={game} onValueChange={(value) => setGame(value ?? "all")}>
            <SelectTrigger size="sm" className="w-44">
              <SelectValue>{(value) => (value === "all" ? t.allGames : displaySlug(String(value)))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">{t.allGames}</SelectItem>
                {games.map((value) => (
                  <SelectItem key={value} value={value}>
                    {displaySlug(value)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}
        <Button variant={liveOnly ? "default" : "outline"} size="sm" onClick={() => setLiveOnly((value) => !value)}>
          <RadioIcon data-icon="inline-start" />
          {t.liveOnly}
        </Button>
      </div>

      {filtered.length ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((stream) => {
            const selected = selectedSet.has(stream.id);
            const canWatch = selectableIds.has(stream.id);
            return (
              <div key={stream.id} className="flex min-w-0 items-center gap-3 rounded-lg border p-3">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
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
                <div className="flex shrink-0 items-center gap-1">
                  {stream.channels.map((channel) =>
                    channel.url ? (
                      <a
                        key={`${channel.platform}:${channel.handle}`}
                        href={channel.url}
                        target="_blank"
                        rel="noreferrer"
                        className="p-2 text-muted-foreground hover:text-foreground"
                        aria-label={t.openOn(channelLabel(channel))}
                      >
                        <PlatformIcon platform={channel.platform} className="size-4" />
                      </a>
                    ) : null,
                  )}
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant={selected ? "default" : "outline"}
                          size="icon-sm"
                          disabled={!selected && !canWatch}
                          aria-pressed={selected}
                          aria-label={`${selected ? t.removeStream : t.addStream}: ${stream.label}`}
                          onClick={() => toggleStream(stream.id)}
                        />
                      }
                    >
                      {selected ? <X /> : <Plus />}
                    </TooltipTrigger>
                    <TooltipContent>{selected ? t.removeStream : t.addStream}</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-md border border-dashed p-5 text-center sm:p-8">
          <p className="text-sm text-muted-foreground">{streams.length ? t.noneFiltered : t.none}</p>
        </div>
      )}
    </main>
  );
}
