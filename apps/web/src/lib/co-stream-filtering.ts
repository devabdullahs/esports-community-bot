import type { CoStream, StreamPlatform } from "@/lib/stream-types";

export const ALL_CO_STREAM_FILTER = "all";

export type CoStreamPlatformFilter = StreamPlatform | typeof ALL_CO_STREAM_FILTER;

export type CoStreamFilters = {
  platform: CoStreamPlatformFilter;
  game: string;
  language: string;
  liveOnly: boolean;
};

export const DEFAULT_CO_STREAM_FILTERS: CoStreamFilters = {
  platform: ALL_CO_STREAM_FILTER,
  game: ALL_CO_STREAM_FILTER,
  language: ALL_CO_STREAM_FILTER,
  liveOnly: false,
};

const LANGUAGE_ALIASES: Record<string, string> = {
  arabic: "ar",
  english: "en",
};

export function normalizeCoStreamLanguage(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase().replaceAll("_", "-");
  if (!normalized) return null;

  const primary = normalized.split("-", 1)[0];
  return LANGUAGE_ALIASES[primary] ?? primary;
}

export function coStreamLanguages(streams: CoStream[]) {
  const languages = new Set<string>();
  for (const stream of streams) {
    const language = normalizeCoStreamLanguage(stream.language);
    if (language) languages.add(language);
  }
  return [...languages].sort();
}

export function coStreamGames(streams: CoStream[]) {
  const games = new Set<string>();
  for (const stream of streams) {
    for (const game of stream.gameSlugs) {
      if (game) games.add(game);
    }
  }
  return [...games];
}

export function filterCoStreams(streams: CoStream[], filters: CoStreamFilters) {
  const language = normalizeCoStreamLanguage(filters.language);
  return streams.filter(
    (stream) =>
      (filters.platform === ALL_CO_STREAM_FILTER ||
        stream.channels.some((channel) => channel.platform === filters.platform)) &&
      (filters.game === ALL_CO_STREAM_FILTER || stream.gameSlugs.includes(filters.game)) &&
      (filters.language === ALL_CO_STREAM_FILTER || normalizeCoStreamLanguage(stream.language) === language) &&
      (!filters.liveOnly || stream.isLive),
  );
}

export function hasActiveCoStreamFilters(filters: CoStreamFilters) {
  return (
    filters.platform !== ALL_CO_STREAM_FILTER ||
    filters.game !== ALL_CO_STREAM_FILTER ||
    filters.language !== ALL_CO_STREAM_FILTER ||
    filters.liveOnly
  );
}

export function firstVisibleLiveCoStreamId(streams: CoStream[], filters: CoStreamFilters) {
  return filterCoStreams(streams, filters).find((stream) => stream.isLive && stream.embedChannel)?.id ?? null;
}

export function selectedCoStreamIdAfterFiltering(
  selectedId: string | null,
  streams: CoStream[],
  filters: CoStreamFilters,
) {
  if (!selectedId || filterCoStreams(streams, filters).some((stream) => stream.id === selectedId)) {
    return selectedId;
  }
  return firstVisibleLiveCoStreamId(streams, filters);
}
