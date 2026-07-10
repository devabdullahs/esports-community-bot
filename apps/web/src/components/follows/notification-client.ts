import { infiniteQueryOptions } from "@tanstack/react-query";
import {
  NOTIFICATION_PAGE_SIZE,
  NOTIFICATION_REFETCH_INTERVAL_MS,
  notificationQueryKey,
  type NotificationPage,
} from "@/components/follows/notification-model";

export type EntityType = "game" | "tournament" | "team" | "player";

export type FollowRow = {
  id: number;
  entity_type: EntityType;
  entity_key: string;
  entity_label: string;
  entity_ref: string;
};

export type NotificationPrefs = {
  dm_enabled: number;
  notify_match_start: number;
  notify_match_result: number;
};

export type NotificationPrefsPatch = {
  dmEnabled?: boolean;
  notifyMatchStart?: boolean;
  notifyMatchResult?: boolean;
};

export const followsQueryKey = ["me", "follows"] as const;
export const notificationPrefsQueryKey = ["me", "notification-prefs"] as const;

async function jsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`Request failed with status ${response.status}.`);
  return response.json() as Promise<T>;
}

export async function fetchNotificationPage(offset: number, signal?: AbortSignal) {
  const params = new URLSearchParams({
    limit: String(NOTIFICATION_PAGE_SIZE),
    offset: String(offset),
  });
  return jsonOrThrow<NotificationPage>(
    await fetch(`/api/me/notifications?${params.toString()}`, {
      cache: "no-store",
      signal,
    }),
  );
}

export function notificationInfiniteQueryOptions() {
  return infiniteQueryOptions({
    queryKey: notificationQueryKey,
    queryFn: ({ pageParam, signal }) => fetchNotificationPage(pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    staleTime: 30_000,
    refetchInterval: NOTIFICATION_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });
}

export async function fetchFollows(signal?: AbortSignal) {
  const data = await jsonOrThrow<{ follows?: FollowRow[] }>(
    await fetch("/api/me/follows", { cache: "no-store", signal }),
  );
  return data.follows ?? [];
}

export async function removeFollow(row: FollowRow) {
  return jsonOrThrow<{ removed: number }>(
    await fetch("/api/me/follows", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityType: row.entity_type, entityKey: row.entity_key }),
    }),
  );
}

export async function fetchNotificationPrefs(signal?: AbortSignal) {
  const data = await jsonOrThrow<{ prefs: NotificationPrefs }>(
    await fetch("/api/me/notification-prefs", { cache: "no-store", signal }),
  );
  return data.prefs;
}

export async function updateNotificationPrefs(patch: NotificationPrefsPatch) {
  const data = await jsonOrThrow<{ prefs: NotificationPrefs }>(
    await fetch("/api/me/notification-prefs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  );
  return data.prefs;
}

export async function markNotificationRead(id: number) {
  return jsonOrThrow<{ marked: number }>(
    await fetch("/api/me/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
      keepalive: true,
    }),
  );
}

export async function markAllNotificationsRead() {
  return jsonOrThrow<{ marked: number }>(
    await fetch("/api/me/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    }),
  );
}
