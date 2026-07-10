"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { notificationInfiniteQueryOptions } from "@/components/follows/notification-client";
import { notificationUnreadCount } from "@/components/follows/notification-model";
import { Badge } from "@/components/ui/badge";
import { copy, formatNumber, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function useUnreadNotifications(enabled: boolean) {
  const query = useInfiniteQuery({
    ...notificationInfiniteQueryOptions(),
    enabled,
  });
  return enabled ? notificationUnreadCount(query.data) : 0;
}

export function NotificationUnreadBadge({
  count,
  locale,
  className,
}: {
  count: number;
  locale: Locale;
  className?: string;
}) {
  if (count <= 0) return null;
  const visibleCount = count > 99 ? `${formatNumber(99, locale)}+` : formatNumber(count, locale);
  return (
    <Badge
      variant="destructive"
      className={cn("h-5 min-w-5 px-1 text-[0.65rem] tabular-nums", className)}
      aria-label={copy[locale].follows.unreadCount(count)}
      title={copy[locale].follows.unreadCount(count)}
    >
      <span dir="ltr">{visibleCount}</span>
    </Badge>
  );
}
