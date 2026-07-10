import type { InfiniteData } from "@tanstack/react-query";

export const NOTIFICATION_PAGE_SIZE = 20;
export const NOTIFICATION_REFETCH_INTERVAL_MS = 45_000;
export const notificationQueryKey = ["me", "notifications"] as const;

export type NotificationRow = {
  id: number;
  type: "match_start" | "match_result";
  title: string;
  body: string;
  url: string;
  read_at: string | null;
  created_at: string;
};

export type NotificationPage = {
  notifications: NotificationRow[];
  unread: number;
  nextOffset: number | null;
};

export type NotificationInfiniteData = InfiniteData<NotificationPage>;

export function notificationUnreadCount(data: NotificationInfiniteData | undefined) {
  return Math.max(0, Number(data?.pages[0]?.unread) || 0);
}

export function mergeNotificationPages(data: NotificationInfiniteData | undefined) {
  const byId = new Map<number, NotificationRow>();
  for (const page of data?.pages ?? []) {
    for (const notification of page.notifications) {
      if (!byId.has(notification.id)) byId.set(notification.id, notification);
    }
  }

  return [...byId.values()].sort((left, right) => {
    if (left.created_at !== right.created_at) {
      return left.created_at < right.created_at ? 1 : -1;
    }
    return right.id - left.id;
  });
}

export function markNotificationReadInData(
  data: NotificationInfiniteData | undefined,
  id: number,
  readAt: string,
) {
  if (!data) return data;
  const wasUnread = data.pages.some((page) =>
    page.notifications.some((notification) => notification.id === id && !notification.read_at),
  );
  if (!wasUnread) return data;

  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      unread: Math.max(0, page.unread - 1),
      notifications: page.notifications.map((notification) =>
        notification.id === id && !notification.read_at
          ? { ...notification, read_at: readAt }
          : notification,
      ),
    })),
  };
}

export function rollbackNotificationReadInData(
  data: NotificationInfiniteData | undefined,
  id: number,
  optimisticReadAt: string,
) {
  if (!data) return data;
  const shouldRollback = data.pages.some((page) =>
    page.notifications.some(
      (notification) => notification.id === id && notification.read_at === optimisticReadAt,
    ),
  );
  if (!shouldRollback) return data;

  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      unread: page.unread + 1,
      notifications: page.notifications.map((notification) =>
        notification.id === id && notification.read_at === optimisticReadAt
          ? { ...notification, read_at: null }
          : notification,
      ),
    })),
  };
}

export function markAllNotificationsReadInData(
  data: NotificationInfiniteData | undefined,
  readAt: string,
) {
  if (!data || notificationUnreadCount(data) === 0) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      unread: 0,
      notifications: page.notifications.map((notification) =>
        notification.read_at ? notification : { ...notification, read_at: readAt },
      ),
    })),
  };
}
