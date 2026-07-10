"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BellIcon,
  CheckCheckIcon,
  CheckIcon,
  FlagIcon,
  Loader2Icon,
  PlayIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DateTime } from "@/components/date-time";
import {
  markAllNotificationsRead,
  markNotificationRead,
  notificationInfiniteQueryOptions,
} from "@/components/follows/notification-client";
import {
  markAllNotificationsReadInData,
  markNotificationReadInData,
  mergeNotificationPages,
  notificationQueryKey,
  notificationUnreadCount,
  rollbackNotificationReadInData,
  type NotificationInfiniteData,
  type NotificationRow,
} from "@/components/follows/notification-model";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { copy, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function NotificationInbox({ locale }: { locale: Locale }) {
  const text = copy[locale].follows;
  const queryClient = useQueryClient();
  const query = useInfiniteQuery(notificationInfiniteQueryOptions());
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [pendingReadIds, setPendingReadIds] = useState<Set<number>>(() => new Set());
  const notifications = mergeNotificationPages(query.data);
  const unread = notificationUnreadCount(query.data);

  const markOneMutation = useMutation({
    mutationKey: ["me", "notifications", "mark-read"],
    mutationFn: markNotificationRead,
    onMutate: async (id) => {
      setPendingReadIds((current) => new Set(current).add(id));
      await queryClient.cancelQueries({ queryKey: notificationQueryKey });
      const previous = queryClient.getQueryData<NotificationInfiniteData>(notificationQueryKey);
      const readAt = new Date().toISOString();
      queryClient.setQueryData<NotificationInfiniteData>(notificationQueryKey, (current) =>
        markNotificationReadInData(current, id, readAt),
      );
      return { previous, readAt };
    },
    onError: (_error, id, context) => {
      if (context) {
        queryClient.setQueryData<NotificationInfiniteData>(notificationQueryKey, (current) =>
          current
            ? rollbackNotificationReadInData(current, id, context.readAt)
            : context.previous,
        );
      }
      setMutationError(text.markReadFailed);
      void queryClient.invalidateQueries({ queryKey: notificationQueryKey });
    },
    onSuccess: () => setMutationError(null),
    onSettled: (_data, _error, id) => {
      setPendingReadIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    },
  });

  const markAllMutation = useMutation({
    mutationKey: ["me", "notifications", "mark-all-read"],
    mutationFn: markAllNotificationsRead,
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: notificationQueryKey });
      const previous = queryClient.getQueryData<NotificationInfiniteData>(notificationQueryKey);
      const readAt = new Date().toISOString();
      queryClient.setQueryData<NotificationInfiniteData>(notificationQueryKey, (current) =>
        markAllNotificationsReadInData(current, readAt),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(notificationQueryKey, context.previous);
      setMutationError(text.markAllReadFailed);
      void queryClient.invalidateQueries({ queryKey: notificationQueryKey });
    },
    onSuccess: () => setMutationError(null),
  });

  const loadError = query.isError || query.isFetchNextPageError || query.isRefetchError;
  const visibleError = mutationError ?? (loadError ? text.loadFailed : null);

  function markRead(notification: NotificationRow) {
    if (notification.read_at || pendingReadIds.has(notification.id)) return;
    markOneMutation.mutate(notification.id);
  }

  return (
    <Card id="notifications" className="lg:col-span-2" aria-busy={query.isPending || undefined}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BellIcon className="size-4 text-primary" />
              {text.notificationsTitle}
              {unread > 0 ? <Badge>{text.unreadCount(unread)}</Badge> : null}
            </CardTitle>
            <CardDescription>{text.notificationsDescription}</CardDescription>
          </div>
          {unread > 0 || markAllMutation.isPending ? (
            <Button
              variant="outline"
              size="sm"
              disabled={markAllMutation.isPending}
              onClick={() => markAllMutation.mutate()}
            >
              {markAllMutation.isPending ? (
                <Loader2Icon data-icon="inline-start" className="animate-spin" />
              ) : (
                <CheckCheckIcon data-icon="inline-start" />
              )}
              {text.markAllRead}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        {visibleError ? (
          <p className="text-sm text-destructive" role="alert">
            {visibleError}
          </p>
        ) : null}
        {query.isPending ? <Loader2Icon className="size-4 animate-spin text-muted-foreground" /> : null}
        {!query.isPending && !query.isError && notifications.length === 0 ? (
          <p className="text-sm text-muted-foreground">{text.noNotifications}</p>
        ) : null}
        {notifications.map((notification) => {
          const pendingRead = pendingReadIds.has(notification.id);
          const contentClassName = cn(
            "flex min-w-0 flex-1 flex-wrap items-center gap-2 rounded-md px-2.5 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring",
            notification.url && (notification.read_at ? "hover:bg-muted/30" : "hover:bg-primary/10"),
          );
          const content = (
            <>
              {notification.type === "match_start" ? (
                <PlayIcon className="size-3.5 shrink-0 text-destructive" />
              ) : (
                <FlagIcon className="size-3.5 shrink-0 text-primary" />
              )}
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {notification.type === "match_start" ? text.matchStart : text.matchResult}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto">
                {notification.title}
                {notification.body ? <span className="text-muted-foreground"> - {notification.body}</span> : null}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                <DateTime value={notification.created_at} locale={locale} />
              </span>
            </>
          );

          return (
            <div
              key={notification.id}
              className={cn(
                "flex items-center gap-1 rounded-lg border p-0.5 transition-colors",
                notification.read_at
                  ? "border-border/50 bg-background/30"
                  : "border-primary/30 bg-primary/5",
              )}
            >
              {notification.url ? (
                <Link
                  href={notification.url}
                  className={contentClassName}
                  aria-label={text.openNotification}
                  onClick={() => markRead(notification)}
                >
                  {content}
                </Link>
              ) : (
                <div className={contentClassName}>{content}</div>
              )}
              {!notification.read_at ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={pendingRead}
                  title={text.markRead}
                  aria-label={`${text.markRead}: ${notification.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    markRead(notification);
                  }}
                >
                  {pendingRead ? (
                    <Loader2Icon data-icon="inline-start" className="animate-spin" />
                  ) : (
                    <CheckIcon data-icon="inline-start" />
                  )}
                </Button>
              ) : null}
            </div>
          );
        })}
        {query.hasNextPage ? (
          <div className="flex justify-center pt-2">
            <Button
              variant="outline"
              size="sm"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? (
                <Loader2Icon data-icon="inline-start" className="animate-spin" />
              ) : null}
              {text.loadMore}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
