import type { CoStream } from "@/lib/stream-types";

export const MAX_MULTI_STREAMS = 9;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function sanitizeRequestedStreamIds(value: string | string[] | undefined): string[] {
  const values = value == null ? [] : Array.isArray(value) ? value : [value];
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const raw of values) {
    const id = raw.trim();
    if (!id || id.length > 240 || CONTROL_CHARACTERS.test(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length === MAX_MULTI_STREAMS) break;
  }

  return ids;
}

export function initialSelectedStreamIds(
  requested: string[],
  streams: CoStream[],
  hasExplicitSelection: boolean,
): string[] {
  const availableIds = new Set(streams.map((stream) => stream.id));
  const selected = sanitizeRequestedStreamIds(requested).filter((id) => availableIds.has(id));
  if (hasExplicitSelection) return selected;

  const fallback = streams.find((stream) => stream.isLive && stream.embedChannel);
  return fallback ? [fallback.id] : [];
}

export function reconcileSelectedStreamIds(selected: string[], streams: CoStream[]): string[] {
  const availableIds = new Set(streams.map((stream) => stream.id));
  return sanitizeRequestedStreamIds(selected).filter((id) => availableIds.has(id));
}

export function initialLoadedStreamIds(selected: string[], streams: CoStream[]): string[] {
  const byId = new Map(streams.map((stream) => [stream.id, stream]));
  const id = sanitizeRequestedStreamIds(selected).find((selectedId) => {
    const stream = byId.get(selectedId);
    return Boolean(stream?.isLive && stream.embedChannel);
  });
  return id ? [id] : [];
}

export function reconcileLoadedStreamIds(loaded: string[], selected: string[]): string[] {
  const selectedIds = new Set(sanitizeRequestedStreamIds(selected));
  return sanitizeRequestedStreamIds(loaded).filter((id) => selectedIds.has(id));
}

export function toggleSelectedStreamId(
  selected: string[],
  id: string,
  selectableIds: Iterable<string>,
): { ids: string[]; limitReached: boolean } {
  const ids = sanitizeRequestedStreamIds(selected);
  if (ids.includes(id)) {
    return { ids: ids.filter((selectedId) => selectedId !== id), limitReached: false };
  }

  if (!new Set(selectableIds).has(id)) return { ids, limitReached: false };
  if (ids.length >= MAX_MULTI_STREAMS) return { ids, limitReached: true };
  return { ids: [...ids, id], limitReached: false };
}

export function streamSelectionSearchParams(ids: string[]): ["stream", string][] {
  return sanitizeRequestedStreamIds(ids).map((id) => ["stream", id]);
}

export function multiviewGridClass(count: number): string {
  const boundedCount = Math.max(0, Math.min(MAX_MULTI_STREAMS, Math.trunc(count)));
  if (boundedCount < 2) return "grid grid-cols-1 gap-4";
  if (boundedCount === 2) return "grid grid-cols-1 gap-4 xl:grid-cols-2";
  return "grid grid-cols-1 gap-4 xl:grid-cols-2 min-[112rem]:grid-cols-3";
}
