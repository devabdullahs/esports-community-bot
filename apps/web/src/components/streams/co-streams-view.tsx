"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ListPlus, Plus, RadioIcon, Share2, UsersIcon, X } from "lucide-react";
import { PlatformIcon } from "@/components/platform-icon";
import { MultiStreamGrid } from "@/components/streams/multi-stream-grid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Locale } from "@/lib/i18n";
import {
  MAX_MULTI_STREAMS,
  effectiveLoadedStreamIds,
  initialLoadedStreamIds,
  initialSelectedStreamIds,
  loadedIdsAfterStreamAdded,
  loadedIdsAfterStreamLoad,
  reconcileLoadedStreamIds,
  reconcileSelectedStreamIds,
  reorderSelectedStreamIds,
  singlePlayerSelectionIds,
  streamSelectionSearchParams,
  toggleSelectedStreamId,
} from "@/lib/co-stream-multiview";
import {
  ALL_CO_STREAM_FILTER,
  DEFAULT_CO_STREAM_FILTERS,
  coStreamGames,
  coStreamLanguages,
  filterCoStreams,
  hasActiveCoStreamFilters,
  normalizeCoStreamLanguage,
  selectedCoStreamIdAfterFiltering,
} from "@/lib/co-stream-filtering";
import { trackProductEvent } from "@/lib/product-analytics";
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
    reorderStream: (name: string) => `Reorder ${name}`,
    streamMoved: (name: string) => `${name} moved.`,
    mobileTwitchUnavailable:
      "Twitch embeds require a player wider than this screen. Open the stream on Twitch to watch.",
    mobilePlaybackHint:
      "Mobile browsers allow one embedded player at a time. Twitch streams open on Twitch when the screen is too narrow for its supported player.",
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
    reorderStream: (name: string) => `إعادة ترتيب ${name}`,
    streamMoved: (name: string) => `تم نقل ${name}.`,
    mobileTwitchUnavailable: "يتطلب مشغّل Twitch المضمّن شاشة أعرض. افتح البث على Twitch للمشاهدة.",
    mobilePlaybackHint:
      "تسمح متصفحات الجوال بمشغّل مضمّن واحد في كل مرة. تُفتح بثوث Twitch على المنصة عندما تكون الشاشة أضيق من حجم المشغّل المدعوم.",
  },
} as const;

type FilterCopy = {
  platform: string;
  game: string;
  language: string;
  allLanguages: string;
  arabic: string;
  english: string;
  activeFilters: string;
  clearFilters: string;
};

const FILTER_STR: Record<Locale, FilterCopy> = {
  en: {
    platform: "Platform",
    game: "Game",
    language: "Language",
    allLanguages: "All languages",
    arabic: "Arabic",
    english: "English",
    activeFilters: "Active filters",
    clearFilters: "Clear filters",
  },
  ar: {
    platform: "المنصة",
    game: "اللعبة",
    language: "اللغة",
    allLanguages: "كل اللغات",
    arabic: "العربية",
    english: "الإنجليزية",
    activeFilters: "الفلاتر النشطة",
    clearFilters: "مسح الفلاتر",
  },
};

function displaySlug(slug: string) {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function channelLabel(channel: CoStreamChannel) {
  return PLATFORM_LABELS[channel.platform] ?? channel.platform;
}

function languageLabel(language: string, copy: FilterCopy) {
  if (language === "ar") return copy.arabic;
  if (language === "en") return copy.english;
  return language.toUpperCase();
}

function selectionUrl(ids: string[]) {
  const url = new URL(window.location.href);
  url.searchParams.delete("stream");
  for (const [key, value] of streamSelectionSearchParams(ids)) url.searchParams.append(key, value);
  return url;
}

const MOBILE_PLAYER_QUERY = "(max-width: 767px)";
const TWITCH_EMBED_WIDTH_QUERY = "(min-width: 400px)";

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

function subscribeTwitchEmbedWidth(callback: () => void) {
  const media = window.matchMedia(TWITCH_EMBED_WIDTH_QUERY);
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", callback);
    return () => media.removeEventListener("change", callback);
  }
  media.addListener(callback);
  return () => media.removeListener(callback);
}

function twitchEmbedWidthSnapshot() {
  return window.matchMedia(TWITCH_EMBED_WIDTH_QUERY).matches;
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
  const filterText = FILTER_STR[locale] ?? FILTER_STR.en;
  const [streams, setStreams] = useState<CoStream[]>(initialStreams);
  const [platform, setPlatform] = useState<"all" | StreamPlatform>(DEFAULT_CO_STREAM_FILTERS.platform);
  const [game, setGame] = useState(DEFAULT_CO_STREAM_FILTERS.game);
  const [language, setLanguage] = useState(DEFAULT_CO_STREAM_FILTERS.language);
  const [liveOnly, setLiveOnly] = useState(DEFAULT_CO_STREAM_FILTERS.liveOnly);
  const [selectedIds, setSelectedIds] = useState(() =>
    initialSelectedStreamIds(requestedStreamIds, initialStreams, hasExplicitSelection),
  );
  const [loadedIds, setLoadedIds] = useState(() => initialLoadedStreamIds(selectedIds, initialStreams));
  const [shareStatus, setShareStatus] = useState("");
  const singleMobilePlayer = useSyncExternalStore(subscribeMobilePlayer, mobilePlayerSnapshot, () => false);
  const twitchEmbedsSupported = useSyncExternalStore(subscribeTwitchEmbedWidth, twitchEmbedWidthSnapshot, () => false);
  const shareStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didMountSelection = useRef(false);
  const selectionBeforeMobileFilter = useRef<string[] | null>(null);

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
        const res = await fetch("/api/co-streams", {
          cache: "no-store",
          signal: controller.signal,
        });
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
  const games = useMemo(() => coStreamGames(streams), [streams]);
  const languages = useMemo(() => coStreamLanguages(streams), [streams]);
  const displaySelectedIds = useMemo(
    () => (singleMobilePlayer ? singlePlayerSelectionIds(selectedIds, loadedIds) : selectedIds),
    [loadedIds, selectedIds, singleMobilePlayer],
  );
  const selectedStreams = useMemo(() => {
    const byId = new Map(streams.map((stream) => [stream.id, stream]));
    return displaySelectedIds.map((id) => byId.get(id)).filter((stream): stream is CoStream => Boolean(stream));
  }, [displaySelectedIds, streams]);
  const playbackLoadedIds = useMemo(
    () => effectiveLoadedStreamIds(displaySelectedIds, loadedIds, singleMobilePlayer),
    [displaySelectedIds, loadedIds, singleMobilePlayer],
  );
  const selectableIds = useMemo(
    () => new Set(streams.filter((stream) => stream.isLive && stream.embedChannel).map((stream) => stream.id)),
    [streams],
  );
  const selectedSet = useMemo(() => new Set(displaySelectedIds), [displaySelectedIds]);
  const atLimit = selectedIds.length >= MAX_MULTI_STREAMS;
  const filters = useMemo(() => ({ platform, game, language, liveOnly }), [game, language, liveOnly, platform]);
  const filtered = useMemo(() => filterCoStreams(streams, filters), [filters, streams]);
  const filtersActive = hasActiveCoStreamFilters(filters);
  const activeFilters = useMemo(() => {
    const values: string[] = [];
    if (platform !== ALL_CO_STREAM_FILTER) values.push(`${filterText.platform}: ${PLATFORM_LABELS[platform]}`);
    if (game !== ALL_CO_STREAM_FILTER) values.push(`${filterText.game}: ${displaySlug(game)}`);
    if (language !== ALL_CO_STREAM_FILTER) values.push(`${filterText.language}: ${languageLabel(language, filterText)}`);
    if (liveOnly) values.push(t.liveOnly);
    return values;
  }, [filterText, game, language, liveOnly, platform, t.liveOnly]);

  useEffect(() => {
    if (!singleMobilePlayer) return;

    if (!filtersActive) {
      const previousSelection = selectionBeforeMobileFilter.current;
      if (!previousSelection) return;

      const restoredSelection = reconcileSelectedStreamIds(previousSelection, streams);
      setSelectedIds(restoredSelection);
      setLoadedIds(initialLoadedStreamIds(restoredSelection, streams));
      selectionBeforeMobileFilter.current = null;
      return;
    }

    const activeId = singlePlayerSelectionIds(selectedIds, loadedIds)[0] ?? null;
    const nextId = selectedCoStreamIdAfterFiltering(activeId, streams, filters);
    if (nextId === activeId) return;

    if (!selectionBeforeMobileFilter.current) selectionBeforeMobileFilter.current = selectedIds;
    setSelectedIds(nextId ? [nextId] : []);
    setLoadedIds(nextId ? [nextId] : []);
  }, [filters, filtersActive, loadedIds, selectedIds, singleMobilePlayer, streams]);

  const toggleStream = (id: string) => {
    if (singleMobilePlayer) {
      if (!selectableIds.has(id) || selectedSet.has(id)) return;
      setSelectedIds([id]);
      setLoadedIds([id]);
      return;
    }

    const wasSelected = selectedSet.has(id);
    const result = toggleSelectedStreamId(selectedIds, id, selectableIds);
    if (result.ids === selectedIds || (result.ids.length === selectedIds.length && !wasSelected)) return;
    if (!wasSelected && selectedIds.length < 2 && result.ids.length === 2) {
      trackProductEvent("multiview_start");
    }
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
      trackProductEvent("multiview_share");
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

      <div className="hidden flex-wrap items-center gap-2 md:flex">
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
        loadedIds={playbackLoadedIds}
        parent={parent}
        autoplay={!singleMobilePlayer}
        compactViewport={singleMobilePlayer}
        twitchEmbedsSupported={twitchEmbedsSupported}
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
          reorderStream: t.reorderStream,
          streamMoved: t.streamMoved,
          mobileTwitchUnavailable: t.mobileTwitchUnavailable,
        }}
        onLoad={(id) =>
          setLoadedIds((current) => loadedIdsAfterStreamLoad(current, selectedIds, id, singleMobilePlayer))
        }
        onRemove={removeStream}
        onReorder={(activeId, overId) =>
          setSelectedIds((current) => reorderSelectedStreamIds(current, activeId, overId))
        }
      />

      {selectedIds.length > 1 ? (
        <p className="text-xs text-muted-foreground md:hidden">{t.mobilePlaybackHint}</p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {platforms.length > 1 ? (
          <Select value={platform} onValueChange={(value) => setPlatform((value as "all" | StreamPlatform) ?? "all")}>
            <SelectTrigger size="sm" className="w-full sm:w-36" aria-label={filterText.platform}>
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
            <SelectTrigger size="sm" className="w-full sm:w-44" aria-label={filterText.game}>
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
        {languages.length ? (
          <Select value={language} onValueChange={(value) => setLanguage(normalizeCoStreamLanguage(value) ?? ALL_CO_STREAM_FILTER)}>
            <SelectTrigger size="sm" className="w-full sm:w-40" aria-label={filterText.language}>
              <SelectValue>
                {(value) =>
                  value === ALL_CO_STREAM_FILTER
                    ? filterText.allLanguages
                    : languageLabel(String(value), filterText)
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={ALL_CO_STREAM_FILTER}>{filterText.allLanguages}</SelectItem>
                {languages.map((value) => (
                  <SelectItem key={value} value={value}>
                    {languageLabel(value, filterText)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}
        <Button
          variant={liveOnly ? "default" : "outline"}
          size="sm"
          className="w-full sm:w-auto"
          onClick={() => setLiveOnly((value) => !value)}
        >
          <RadioIcon data-icon="inline-start" />
          {t.liveOnly}
        </Button>
      </div>

      {filtersActive ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex flex-wrap items-center gap-1.5" aria-label={filterText.activeFilters}>
            {activeFilters.map((label) => (
              <Badge key={label} variant="secondary" className="max-w-full truncate">
                {label}
              </Badge>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => {
              setPlatform(DEFAULT_CO_STREAM_FILTERS.platform);
              setGame(DEFAULT_CO_STREAM_FILTERS.game);
              setLanguage(DEFAULT_CO_STREAM_FILTERS.language);
              setLiveOnly(DEFAULT_CO_STREAM_FILTERS.liveOnly);
            }}
          >
            <X data-icon="inline-start" />
            {filterText.clearFilters}
          </Button>
        </div>
      ) : null}

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
                          className={selected ? "hidden md:inline-flex" : undefined}
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
