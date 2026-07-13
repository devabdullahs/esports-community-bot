"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BellIcon,
  BellOffIcon,
  Gamepad2Icon,
  Loader2Icon,
  MessageCircleIcon,
  ShieldIcon,
  TrophyIcon,
  UserIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  fetchFollows,
  fetchNotificationPrefs,
  followsQueryKey,
  notificationPrefsQueryKey,
  removeFollow,
  updateNotificationPrefs,
  type EntityType,
  type FollowRow,
  type NotificationPrefs,
  type NotificationPrefsPatch,
} from "@/components/follows/notification-client";
import { NotificationInbox } from "@/components/follows/notification-inbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Toggle } from "@/components/ui/toggle";
import { copy, localizedPath, type Locale } from "@/lib/i18n";
import { trackProductEvent } from "@/lib/product-analytics";
import { cn } from "@/lib/utils";

const TYPE_ICONS: Record<EntityType, typeof Gamepad2Icon> = {
  game: Gamepad2Icon,
  tournament: TrophyIcon,
  team: ShieldIcon,
  player: UserIcon,
};

type PreferenceKey = keyof NotificationPrefs;
type PreferenceMutation = {
  key: PreferenceKey;
  next: boolean;
  patch: NotificationPrefsPatch;
};

export function FollowCenter({
  locale,
  section = "all",
}: {
  locale: Locale;
  section?: "all" | "following" | "notifications" | "settings";
}) {
  const text = copy[locale].follows;
  const queryClient = useQueryClient();
  const [followError, setFollowError] = useState<string | null>(null);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [pendingFollowIds, setPendingFollowIds] = useState<Set<number>>(() => new Set());
  const [pendingPrefKeys, setPendingPrefKeys] = useState<Set<PreferenceKey>>(() => new Set());

  const followsQuery = useQuery({
    queryKey: followsQueryKey,
    queryFn: ({ signal }) => fetchFollows(signal),
  });
  const prefsQuery = useQuery({
    queryKey: notificationPrefsQueryKey,
    queryFn: ({ signal }) => fetchNotificationPrefs(signal),
  });

  const unfollowMutation = useMutation({
    mutationKey: ["me", "follows", "remove"],
    mutationFn: removeFollow,
    onMutate: async (row) => {
      setPendingFollowIds((current) => new Set(current).add(row.id));
      await queryClient.cancelQueries({ queryKey: followsQueryKey });
      const current = queryClient.getQueryData<FollowRow[]>(followsQueryKey);
      const index = current?.findIndex((follow) => follow.id === row.id) ?? -1;
      queryClient.setQueryData<FollowRow[]>(followsQueryKey, (follows) =>
        follows?.filter((follow) => follow.id !== row.id),
      );
      return { index, row };
    },
    onError: (_error, _row, context) => {
      if (context && context.index >= 0) {
        queryClient.setQueryData<FollowRow[]>(followsQueryKey, (current) => {
          if (current?.some((follow) => follow.id === context.row.id)) return current;
          const restored = [...(current ?? [])];
          restored.splice(Math.min(context.index, restored.length), 0, context.row);
          return restored;
        });
      }
      setFollowError(text.unfollowFailed);
    },
    onSuccess: () => {
      trackProductEvent("follow_remove");
      setFollowError(null);
    },
    onSettled: (_data, _error, row) => {
      setPendingFollowIds((current) => {
        const next = new Set(current);
        next.delete(row.id);
        return next;
      });
    },
  });

  const prefsMutation = useMutation({
    mutationKey: ["me", "notification-prefs", "update"],
    mutationFn: (variables: PreferenceMutation) => updateNotificationPrefs(variables.patch),
    onMutate: async (variables) => {
      setPendingPrefKeys((current) => new Set(current).add(variables.key));
      await queryClient.cancelQueries({ queryKey: notificationPrefsQueryKey });
      const current = queryClient.getQueryData<NotificationPrefs>(notificationPrefsQueryKey);
      const previousValue = current?.[variables.key];
      queryClient.setQueryData<NotificationPrefs>(notificationPrefsQueryKey, (prefs) =>
        prefs ? { ...prefs, [variables.key]: variables.next ? 1 : 0 } : prefs,
      );
      return { previousValue };
    },
    onError: (_error, variables, context) => {
      if (context?.previousValue !== undefined) {
        queryClient.setQueryData<NotificationPrefs>(notificationPrefsQueryKey, (current) =>
          current ? { ...current, [variables.key]: context.previousValue } : current,
        );
      }
      setPrefsError(text.preferencesFailed);
    },
    onSuccess: (prefs, variables) => {
      trackProductEvent("notification_prefs_update");
      queryClient.setQueryData<NotificationPrefs>(notificationPrefsQueryKey, (current) =>
        current ? { ...current, [variables.key]: prefs[variables.key] } : prefs,
      );
      setPrefsError(null);
    },
    onSettled: (_data, _error, variables) => {
      setPendingPrefKeys((current) => {
        const next = new Set(current);
        next.delete(variables.key);
        return next;
      });
    },
  });

  const follows = followsQuery.data ?? [];
  const prefs = prefsQuery.data;
  const visibleFollowError = followError ?? (followsQuery.isError ? text.loadFailed : null);
  const visiblePrefsError = prefsError ?? (prefsQuery.isError ? text.loadFailed : null);

  function updatePref(variables: PreferenceMutation) {
    if (!pendingPrefKeys.has(variables.key)) prefsMutation.mutate(variables);
  }

  return (
    <section className={cn("grid gap-6", section === "all" && "lg:grid-cols-2")}>
      {section === "all" || section === "notifications" ? (
        <NotificationInbox locale={locale} />
      ) : null}

      {section === "all" || section === "following" ? <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellIcon className="size-4 text-primary" />
            {text.followingTitle}
          </CardTitle>
          <CardDescription>{text.followingDescription}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          {visibleFollowError ? (
            <p className="text-sm text-destructive" role="alert">
              {visibleFollowError}
            </p>
          ) : null}
          {followsQuery.isPending ? (
            <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
          ) : null}
          {followsQuery.isSuccess && follows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{text.noFollows}</p>
          ) : null}
          {follows.map((follow) => {
            const Icon = TYPE_ICONS[follow.entity_type] ?? BellIcon;
            const label = follow.entity_label || follow.entity_key;
            const pending = pendingFollowIds.has(follow.id);
            return (
              <div key={follow.id} className="flex items-center gap-2 rounded-lg border border-border/50 px-3 py-2">
                <Icon className="size-3.5 shrink-0 text-primary" />
                <Badge variant="outline">{text.entityTypes[follow.entity_type]}</Badge>
                <span className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto">
                  {follow.entity_ref ? (
                    <Link href={localizedPath(follow.entity_ref, locale)} className="hover:underline">
                      {label}
                    </Link>
                  ) : (
                    label
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={pending}
                  onClick={() => unfollowMutation.mutate(follow)}
                  title={text.unfollow}
                  aria-label={`${text.unfollow}: ${label}`}
                >
                  {pending ? <Loader2Icon className="animate-spin" /> : <XIcon />}
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card> : null}

      {section === "all" || section === "settings" ? <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircleIcon className="size-4 text-primary" />
            {text.settingsTitle}
          </CardTitle>
          <CardDescription>{text.settingsDescription}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {visiblePrefsError ? (
            <p className="text-sm text-destructive" role="alert">
              {visiblePrefsError}
            </p>
          ) : null}
          {prefsQuery.isPending ? (
            <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
          ) : null}
          {prefs ? (
            <>
              <PrefRow
                label={text.dmEnabled}
                help={text.dmEnabledHelp}
                on={Boolean(prefs.dm_enabled)}
                disabled={pendingPrefKeys.has("dm_enabled")}
                onToggle={(next) =>
                  updatePref({ key: "dm_enabled", next, patch: { dmEnabled: next } })
                }
              />
              <PrefRow
                label={text.notifyMatchStart}
                help={text.notifyMatchStartHelp}
                on={Boolean(prefs.notify_match_start)}
                disabled={pendingPrefKeys.has("notify_match_start")}
                onToggle={(next) =>
                  updatePref({
                    key: "notify_match_start",
                    next,
                    patch: { notifyMatchStart: next },
                  })
                }
              />
              <PrefRow
                label={text.notifyMatchResult}
                help={text.notifyMatchResultHelp}
                on={Boolean(prefs.notify_match_result)}
                disabled={pendingPrefKeys.has("notify_match_result")}
                onToggle={(next) =>
                  updatePref({
                    key: "notify_match_result",
                    next,
                    patch: { notifyMatchResult: next },
                  })
                }
              />
            </>
          ) : null}
        </CardContent>
      </Card> : null}
    </section>
  );
}

function PrefRow({
  label,
  help,
  on,
  disabled,
  onToggle,
}: {
  label: string;
  help: string;
  on: boolean;
  disabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border/50 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{help}</div>
      </div>
      <Toggle
        pressed={on}
        disabled={disabled}
        onPressedChange={onToggle}
        aria-label={label}
        variant="outline"
        size="sm"
        className="shrink-0 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
      >
        {disabled ? (
          <Loader2Icon className="size-3.5 animate-spin" />
        ) : on ? (
          <BellIcon className="size-3.5" />
        ) : (
          <BellOffIcon className="size-3.5" />
        )}
      </Toggle>
    </div>
  );
}
