import { describe, expect, test } from "vitest";
import {
  markAllNotificationsReadInData,
  markNotificationReadInData,
  mergeNotificationPages,
  notificationUnreadCount,
  rollbackNotificationReadInData,
  type NotificationInfiniteData,
  type NotificationRow,
} from "@/components/follows/notification-model";

function row(id: number, createdAt: string, readAt: string | null = null): NotificationRow {
  return {
    id,
    type: "match_start",
    title: `Notification ${id}`,
    body: "",
    url: `/notifications/${id}`,
    read_at: readAt,
    created_at: createdAt,
  };
}

function data(pages: NotificationRow[][], unread = 5): NotificationInfiniteData {
  return {
    pages: pages.map((notifications, index) => ({
      notifications,
      unread,
      nextOffset: index === pages.length - 1 ? null : (index + 1) * 3,
    })),
    pageParams: pages.map((_, index) => index * 3),
  };
}

describe("notification model", () => {
  test("merges overlapping pages once and keeps the newest rows first", () => {
    const firstCopy = row(3, "2026-07-10 12:03:00", "2026-07-10 12:10:00");
    const staleCopy = row(3, "2026-07-10 12:03:00");
    const merged = mergeNotificationPages(
      data([
        [row(5, "2026-07-10 12:05:00"), row(4, "2026-07-10 12:04:00"), firstCopy],
        [staleCopy, row(2, "2026-07-10 12:02:00"), row(1, "2026-07-10 12:01:00")],
      ]),
    );

    expect(merged.map((notification) => notification.id)).toEqual([5, 4, 3, 2, 1]);
    expect(merged.find((notification) => notification.id === 3)?.read_at).toBe(firstCopy.read_at);
  });

  test("sorts same-timestamp rows by descending id", () => {
    const merged = mergeNotificationPages(
      data([[row(7, "2026-07-10 12:00:00")], [row(9, "2026-07-10 12:00:00"), row(8, "2026-07-10 12:00:00")]]),
    );
    expect(merged.map((notification) => notification.id)).toEqual([9, 8, 7]);
  });

  test("optimistically marks one row without mutating its rollback snapshot", () => {
    const snapshot = data([[row(3, "2026-07-10 12:03:00"), row(2, "2026-07-10 12:02:00")]], 2);
    const optimistic = markNotificationReadInData(snapshot, 3, "2026-07-10T12:04:00.000Z");

    expect(notificationUnreadCount(optimistic)).toBe(1);
    expect(mergeNotificationPages(optimistic)[0].read_at).toBe("2026-07-10T12:04:00.000Z");
    expect(notificationUnreadCount(snapshot)).toBe(2);
    expect(mergeNotificationPages(snapshot)[0].read_at).toBeNull();
  });

  test("rolls back only the failed row when read mutations overlap", () => {
    const snapshot = data([[row(3, "2026-07-10 12:03:00"), row(2, "2026-07-10 12:02:00")]], 2);
    const firstReadAt = "2026-07-10T12:04:00.000Z";
    const secondReadAt = "2026-07-10T12:05:00.000Z";
    const firstOptimistic = markNotificationReadInData(snapshot, 3, firstReadAt);
    const bothOptimistic = markNotificationReadInData(firstOptimistic, 2, secondReadAt);
    const rolledBack = rollbackNotificationReadInData(bothOptimistic, 3, firstReadAt);

    expect(notificationUnreadCount(rolledBack)).toBe(1);
    expect(mergeNotificationPages(rolledBack).find((notification) => notification.id === 3)?.read_at).toBeNull();
    expect(mergeNotificationPages(rolledBack).find((notification) => notification.id === 2)?.read_at).toBe(secondReadAt);
  });

  test("optimistically marks every loaded row while retaining a reversible snapshot", () => {
    const snapshot = data([[row(3, "2026-07-10 12:03:00")], [row(2, "2026-07-10 12:02:00")]], 2);
    const optimistic = markAllNotificationsReadInData(snapshot, "2026-07-10T12:04:00.000Z");

    expect(notificationUnreadCount(optimistic)).toBe(0);
    expect(mergeNotificationPages(optimistic).every((notification) => notification.read_at)).toBe(true);
    expect(notificationUnreadCount(snapshot)).toBe(2);
    expect(mergeNotificationPages(snapshot).every((notification) => !notification.read_at)).toBe(true);
  });
});
