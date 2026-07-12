import type { CoStream } from "@/lib/stream-types";

export const MAX_MULTI_STREAMS = 6;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

const FIVE_TILE_POSITIONS = [
  "xl:col-start-2 xl:row-start-1 fullscreen:col-start-2 fullscreen:row-start-1",
  "xl:col-start-4 xl:row-start-1 fullscreen:col-start-4 fullscreen:row-start-1",
  "xl:col-start-1 xl:row-start-2 fullscreen:col-start-1 fullscreen:row-start-2",
  "xl:col-start-3 xl:row-start-2 fullscreen:col-start-3 fullscreen:row-start-2",
  "xl:col-start-5 xl:row-start-2 fullscreen:col-start-5 fullscreen:row-start-2",
] as const;

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

export function singlePlayerSelectionIds(selected: string[], loaded: string[] = []): string[] {
  const selectedIds = sanitizeRequestedStreamIds(selected);
  const selectedSet = new Set(selectedIds);
  const activeId = sanitizeRequestedStreamIds(loaded).find((id) => selectedSet.has(id));
  return activeId ? [activeId] : selectedIds.slice(0, 1);
}

export function loadedIdsAfterStreamAdded(
  loaded: string[],
  selected: string[],
  addedId: string,
  singlePlayer: boolean,
): string[] {
  if (singlePlayer) return reconcileLoadedStreamIds(loaded, selected);
  return reconcileLoadedStreamIds([...loaded, addedId], selected);
}

export function loadedIdsAfterStreamLoad(
  loaded: string[],
  selected: string[],
  id: string,
  singlePlayer: boolean,
): string[] {
  return reconcileLoadedStreamIds(singlePlayer ? [id] : [...loaded, id], selected);
}

export function toggleSelectedStreamId(
  selected: string[],
  id: string,
  selectableIds: Iterable<string>,
): { ids: string[]; limitReached: boolean } {
  const ids = sanitizeRequestedStreamIds(selected);
  if (ids.includes(id)) {
    return {
      ids: ids.filter((selectedId) => selectedId !== id),
      limitReached: false,
    };
  }

  if (!new Set(selectableIds).has(id)) return { ids, limitReached: false };
  if (ids.length >= MAX_MULTI_STREAMS) return { ids, limitReached: true };
  return { ids: [...ids, id], limitReached: false };
}

export function streamSelectionSearchParams(ids: string[]): ["stream", string][] {
  return sanitizeRequestedStreamIds(ids).map((id) => ["stream", id]);
}

export function reorderSelectedStreamIds(selected: string[], activeId: string, overId: string): string[] {
  const ids = sanitizeRequestedStreamIds(selected);
  const activeIndex = ids.indexOf(activeId);
  const overIndex = ids.indexOf(overId);
  if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) return ids;

  const reordered = [...ids];
  const [active] = reordered.splice(activeIndex, 1);
  reordered.splice(overIndex, 0, active);
  return reordered;
}

export function multiviewGridClass(count: number): string {
  const boundedCount = Math.max(0, Math.min(MAX_MULTI_STREAMS, Math.trunc(count)));
  const base =
    "grid w-full grid-cols-1 gap-4 fullscreen:self-center fullscreen:flex-1 fullscreen:place-content-center";
  if (boundedCount < 2) return `${base} multiview-fit-one`;
  if (boundedCount === 2) return `${base} xl:grid-cols-2 fullscreen:grid-cols-2`;
  if (boundedCount === 3) return `${base} multiview-fit-two-rows xl:grid-cols-4 fullscreen:grid-cols-4`;
  if (boundedCount === 4) return `${base} multiview-fit-two-rows xl:grid-cols-2 fullscreen:grid-cols-2`;
  if (boundedCount === 5) {
    return `${base} multiview-fit-wide-two-rows xl:grid-cols-6 fullscreen:grid-cols-6`;
  }
  return `${base} multiview-fit-wide-two-rows xl:grid-cols-3 fullscreen:grid-cols-3`;
}

export function multiviewTileClass(count: number, index: number): string {
  const boundedCount = Math.max(0, Math.min(MAX_MULTI_STREAMS, Math.trunc(count)));
  if (boundedCount === 3)
    return index === 0
      ? "xl:col-span-2 xl:col-start-2 fullscreen:col-span-2 fullscreen:col-start-2"
      : "xl:col-span-2 fullscreen:col-span-2";

  if (boundedCount === 5) {
    return `xl:col-span-2 fullscreen:col-span-2 ${FIVE_TILE_POSITIONS[index] ?? ""}`.trim();
  }

  return "";
}
