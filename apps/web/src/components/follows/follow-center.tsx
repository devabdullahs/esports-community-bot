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
import { useMemo, useState } from "react";
import { dmNotBefore } from "@bot/lib/notificationSchedule.js";
import {
  fetchFollows,
  fetchNotificationPrefs,
  followsQueryKey,
  notificationPrefsQueryKey,
  removeFollow,
  updateFollowNotificationOverrides,
  updateNotificationPrefs,
  type EntityType,
  type FollowOverride,
  type FollowRow,
  type NotificationPrefs,
  type NotificationPrefsPatch,
} from "@/components/follows/notification-client";
import { NotificationInbox } from "@/components/follows/notification-inbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

const FALLBACK_TIMEZONES = ["Asia/Riyadh", "Asia/Dubai", "Europe/London", "Europe/Paris", "America/New_York", "America/Los_Angeles", "UTC"];

function timezones() {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return FALLBACK_TIMEZONES;
  }
}

function minuteToTime(minute: number | null) {
  const value = minute ?? 0;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function timeToMinute(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return minute >= 0 && minute < 1440 ? minute : null;
}

type PreferenceKey = keyof NotificationPrefs;
type PreferenceMutation = {
  keys: PreferenceKey[];
  patch: NotificationPrefsPatch;
  optimistic: Partial<NotificationPrefs>;
};
type FollowsCopy = typeof copy.en.follows | typeof copy.ar.follows;

export function FollowCenter({ locale, section = "all" }: { locale: Locale; section?: "all" | "following" | "notifications" | "settings" }) {
  const text = copy[locale].follows;
  const queryClient = useQueryClient();
  const [followError, setFollowError] = useState<string | null>(null);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [timezoneSearch, setTimezoneSearch] = useState("");
  const [pendingFollowIds, setPendingFollowIds] = useState<Set<number>>(() => new Set());
  const [pendingOverrideIds, setPendingOverrideIds] = useState<Set<number>>(() => new Set());
  const [pendingPrefKeys, setPendingPrefKeys] = useState<Set<PreferenceKey>>(() => new Set());
  const followsQuery = useQuery({ queryKey: followsQueryKey, queryFn: ({ signal }) => fetchFollows(signal) });
  const prefsQuery = useQuery({ queryKey: notificationPrefsQueryKey, queryFn: ({ signal }) => fetchNotificationPrefs(signal) });
  const availableTimezones = useMemo(() => timezones(), []);

  const unfollowMutation = useMutation({
    mutationKey: ["me", "follows", "remove"],
    mutationFn: removeFollow,
    onMutate: async (row) => {
      setPendingFollowIds((current) => new Set(current).add(row.id));
      await queryClient.cancelQueries({ queryKey: followsQueryKey });
      const current = queryClient.getQueryData<FollowRow[]>(followsQueryKey);
      const index = current?.findIndex((follow) => follow.id === row.id) ?? -1;
      queryClient.setQueryData<FollowRow[]>(followsQueryKey, (follows) => follows?.filter((follow) => follow.id !== row.id));
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
    onSuccess: () => { trackProductEvent("follow_remove"); setFollowError(null); },
    onSettled: (_data, _error, row) => setPendingFollowIds((current) => { const next = new Set(current); next.delete(row.id); return next; }),
  });

  const followOverrideMutation = useMutation({
    mutationKey: ["me", "follows", "notification-overrides"],
    mutationFn: ({ row, patch }: { row: FollowRow; patch: { notifyMatchStart?: FollowOverride; notifyMatchResult?: FollowOverride } }) => updateFollowNotificationOverrides(row, patch),
    onMutate: async ({ row, patch }) => {
      setPendingOverrideIds((current) => new Set(current).add(row.id));
      await queryClient.cancelQueries({ queryKey: followsQueryKey });
      const previous = queryClient.getQueryData<FollowRow[]>(followsQueryKey);
      queryClient.setQueryData<FollowRow[]>(followsQueryKey, (current) => current?.map((follow) => {
        if (follow.id !== row.id) return follow;
        return {
          ...follow,
          notify_match_start: patch.notifyMatchStart === undefined ? follow.notify_match_start : overrideValue(patch.notifyMatchStart),
          notify_match_result: patch.notifyMatchResult === undefined ? follow.notify_match_result : overrideValue(patch.notifyMatchResult),
        };
      }));
      return { previous };
    },
    onError: (_error, _variables, context) => { queryClient.setQueryData(followsQueryKey, context?.previous); setFollowError(text.updateFailed); },
    onSuccess: (follow) => {
      queryClient.setQueryData<FollowRow[]>(followsQueryKey, (current) => current?.map((row) => row.id === follow.id ? follow : row));
      setFollowError(null);
    },
    onSettled: (_data, _error, variables) => setPendingOverrideIds((current) => { const next = new Set(current); next.delete(variables.row.id); return next; }),
  });

  const prefsMutation = useMutation({
    mutationKey: ["me", "notification-prefs", "update"],
    mutationFn: (variables: PreferenceMutation) => updateNotificationPrefs(variables.patch),
    onMutate: async (variables) => {
      setPendingPrefKeys((current) => new Set([...current, ...variables.keys]));
      await queryClient.cancelQueries({ queryKey: notificationPrefsQueryKey });
      const previous = queryClient.getQueryData<NotificationPrefs>(notificationPrefsQueryKey);
      queryClient.setQueryData<NotificationPrefs>(notificationPrefsQueryKey, (prefs) => prefs ? { ...prefs, ...variables.optimistic } : prefs);
      return { previous };
    },
    onError: (_error, variables, context) => {
      const previous = context?.previous;
      queryClient.setQueryData<NotificationPrefs>(notificationPrefsQueryKey, (current) => {
        if (!current || !previous) return current;
        return { ...current, ...Object.fromEntries(variables.keys.map((key) => [key, previous[key]])) };
      });
      setPrefsError(text.preferencesFailed);
    },
    onSuccess: (prefs, variables) => {
      trackProductEvent("notification_prefs_update");
      queryClient.setQueryData<NotificationPrefs>(notificationPrefsQueryKey, (current) => {
        if (!current) return prefs;
        return { ...current, ...Object.fromEntries(variables.keys.map((key) => [key, prefs[key]])) };
      });
      setPrefsError(null);
    },
    onSettled: (_data, _error, variables) => setPendingPrefKeys((current) => {
      const next = new Set(current);
      for (const key of variables.keys) next.delete(key);
      return next;
    }),
  });

  const follows = followsQuery.data ?? [];
  const prefs = prefsQuery.data;
  const visibleFollowError = followError ?? (followsQuery.isError ? text.loadFailed : null);
  const visiblePrefsError = prefsError ?? (prefsQuery.isError ? text.loadFailed : null);
  const filteredTimezones = availableTimezones.filter((zone) => zone.toLowerCase().includes(timezoneSearch.trim().toLowerCase()));
  const dmEnabled = Boolean(prefs?.dm_enabled);
  const quietOff = !prefs || prefs.quiet_start_minute === null || prefs.quiet_end_minute === null || prefs.quiet_start_minute === prefs.quiet_end_minute;
  const deliveryPreview = prefs ? formatDeliveryPreview(prefs, locale) : "";

  function updatePrefs(variables: PreferenceMutation) {
    if (!variables.keys.some((key) => pendingPrefKeys.has(key))) prefsMutation.mutate(variables);
  }

  return (
    <section className={cn("grid gap-6", section === "all" && "lg:grid-cols-2")}>
      {(section === "all" || section === "notifications") && <NotificationInbox locale={locale} />}

      {(section === "all" || section === "following") && <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BellIcon className="size-4 text-primary" />{text.followingTitle}</CardTitle>
          <CardDescription>{text.followingDescription}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          {visibleFollowError && <p className="text-sm text-destructive" role="alert">{visibleFollowError}</p>}
          {followsQuery.isPending && <Loader2Icon className="size-4 animate-spin text-muted-foreground" />}
          {followsQuery.isSuccess && follows.length === 0 && <p className="text-sm text-muted-foreground">{text.noFollows}</p>}
          {follows.map((follow) => <FollowRowControl
            key={follow.id}
            follow={follow}
            locale={locale}
            text={text}
            pending={pendingFollowIds.has(follow.id)}
            pendingOverride={pendingOverrideIds.has(follow.id)}
            onRemove={() => unfollowMutation.mutate(follow)}
            onOverride={(patch) => followOverrideMutation.mutate({ row: follow, patch })}
          />)}
        </CardContent>
      </Card>}

      {(section === "all" || section === "settings") && <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><MessageCircleIcon className="size-4 text-primary" />{text.settingsTitle}</CardTitle>
          <CardDescription>{text.settingsDescription}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {visiblePrefsError && <p className="text-sm text-destructive" role="alert">{visiblePrefsError}</p>}
          {prefsQuery.isPending && <Loader2Icon className="size-4 animate-spin text-muted-foreground" />}
          {prefs && <>
            <PrefRow label={text.dmEnabled} help={text.dmEnabledHelp} on={Boolean(prefs.dm_enabled)} disabled={pendingPrefKeys.has("dm_enabled")} onToggle={(next) => updatePrefs({ keys: ["dm_enabled"], patch: { dmEnabled: next }, optimistic: { dm_enabled: next ? 1 : 0 } })} />
            <PrefRow label={text.notifyMatchStart} help={text.notifyMatchStartHelp} on={Boolean(prefs.notify_match_start)} disabled={pendingPrefKeys.has("notify_match_start")} onToggle={(next) => updatePrefs({ keys: ["notify_match_start"], patch: { notifyMatchStart: next }, optimistic: { notify_match_start: next ? 1 : 0 } })} />
            <PrefRow label={text.notifyMatchResult} help={text.notifyMatchResultHelp} on={Boolean(prefs.notify_match_result)} disabled={pendingPrefKeys.has("notify_match_result")} onToggle={(next) => updatePrefs({ keys: ["notify_match_result"], patch: { notifyMatchResult: next }, optimistic: { notify_match_result: next ? 1 : 0 } })} />

            <div className={cn("grid gap-3 rounded-lg border border-border/50 p-3", !dmEnabled && "opacity-60")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{text.deliveryMode}</span>
                <div className="inline-flex overflow-hidden rounded-md border border-input" role="group" aria-label={text.deliveryMode}>
                  {(["instant", "daily_digest"] as const).map((mode) => <Button key={mode} type="button" variant={prefs.dm_delivery_mode === mode ? "default" : "ghost"} size="sm" disabled={!dmEnabled || pendingPrefKeys.has("dm_delivery_mode")} onClick={() => updatePrefs({ keys: ["dm_delivery_mode"], patch: { dmDeliveryMode: mode }, optimistic: { dm_delivery_mode: mode } })}>{mode === "instant" ? text.instant : text.dailyDigest}</Button>)}
                </div>
              </div>
              {!dmEnabled && <p className="text-xs text-muted-foreground">{text.dmDisabledHelp}</p>}
              <label className="grid gap-1 text-sm"><span>{text.timezone}</span><Input value={timezoneSearch} disabled={!dmEnabled} placeholder={text.timezoneSearch} onChange={(event) => setTimezoneSearch(event.target.value)} /></label>
              <select className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm disabled:cursor-not-allowed disabled:opacity-50" value={prefs.timezone} disabled={!dmEnabled || pendingPrefKeys.has("timezone")} onChange={(event) => updatePrefs({ keys: ["timezone"], patch: { timezone: event.target.value }, optimistic: { timezone: event.target.value } })} aria-label={text.timezone}>
                {!filteredTimezones.includes(prefs.timezone) && <option value={prefs.timezone}>{prefs.timezone}</option>}
                {filteredTimezones.slice(0, 250).map((zone) => <option key={zone} value={zone}>{zone}</option>)}
              </select>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <label className="grid gap-1 text-sm"><span>{text.quietStart}</span><Input type="time" value={minuteToTime(prefs.quiet_start_minute)} disabled={!dmEnabled || quietOff || pendingPrefKeys.has("quiet_start_minute")} onChange={(event) => { const minute = timeToMinute(event.target.value); if (minute !== null) updatePrefs({ keys: ["quiet_start_minute", "quiet_end_minute"], patch: { quietStartMinute: minute, quietEndMinute: prefs.quiet_end_minute }, optimistic: { quiet_start_minute: minute } }); }} /></label>
                <label className="grid gap-1 text-sm"><span>{text.quietEnd}</span><Input type="time" value={minuteToTime(prefs.quiet_end_minute)} disabled={!dmEnabled || quietOff || pendingPrefKeys.has("quiet_end_minute")} onChange={(event) => { const minute = timeToMinute(event.target.value); if (minute !== null) updatePrefs({ keys: ["quiet_start_minute", "quiet_end_minute"], patch: { quietStartMinute: prefs.quiet_start_minute, quietEndMinute: minute }, optimistic: { quiet_end_minute: minute } }); }} /></label>
                <Toggle pressed={quietOff} disabled={!dmEnabled || pendingPrefKeys.has("quiet_start_minute") || pendingPrefKeys.has("quiet_end_minute")} onPressedChange={(off) => updatePrefs({ keys: ["quiet_start_minute", "quiet_end_minute"], patch: off ? { quietStartMinute: null, quietEndMinute: null } : { quietStartMinute: 23 * 60, quietEndMinute: 7 * 60 }, optimistic: off ? { quiet_start_minute: null, quiet_end_minute: null } : { quiet_start_minute: 23 * 60, quiet_end_minute: 7 * 60 } })} variant="outline" size="sm" className="shrink-0">{text.quietHoursOff}</Toggle>
              </div>
              <label className="grid max-w-48 gap-1 text-sm"><span>{text.digestTime}</span><Input type="time" value={minuteToTime(prefs.digest_minute)} disabled={!dmEnabled || pendingPrefKeys.has("digest_minute")} onChange={(event) => { const minute = timeToMinute(event.target.value); if (minute !== null) updatePrefs({ keys: ["digest_minute"], patch: { digestMinute: minute }, optimistic: { digest_minute: minute } }); }} /></label>
              <p className="text-xs text-muted-foreground">{text.nextDelivery}: {deliveryPreview}</p>
            </div>
          </>}
        </CardContent>
      </Card>}
    </section>
  );
}

function overrideValue(value: FollowOverride) { return value === "inherit" ? null : value === "on" ? 1 : 0; }
function overrideLabel(value: number | null): FollowOverride { return value === null ? "inherit" : value ? "on" : "off"; }

function formatDeliveryPreview(prefs: NotificationPrefs, locale: Locale) {
  const next = dmNotBefore(Math.floor(Date.now() / 1000), prefs);
  try {
    return new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : "en-US", { timeZone: prefs.timezone, weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(next * 1000));
  } catch {
    return new Date(next * 1000).toLocaleString();
  }
}

function FollowRowControl({ follow, locale, text, pending, pendingOverride, onRemove, onOverride }: { follow: FollowRow; locale: Locale; text: FollowsCopy; pending: boolean; pendingOverride: boolean; onRemove: () => void; onOverride: (patch: { notifyMatchStart?: FollowOverride; notifyMatchResult?: FollowOverride }) => void }) {
  const Icon = TYPE_ICONS[follow.entity_type] ?? BellIcon;
  const label = follow.entity_label || follow.entity_key;
  return <div className="grid gap-2 rounded-lg border border-border/50 px-3 py-2 sm:grid-cols-[auto_auto_minmax(0,1fr)_auto_auto] sm:items-center">
    <Icon className="size-3.5 shrink-0 text-primary" />
    <Badge variant="outline">{text.entityTypes[follow.entity_type]}</Badge>
    <span className="min-w-0 truncate text-sm font-medium" dir="auto">{follow.entity_ref ? <Link href={localizedPath(follow.entity_ref, locale)} className="hover:underline">{label}</Link> : label}</span>
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"><span className="shrink-0">{text.perFollow}</span><OverrideSelect label={text.matchStartShort} value={overrideLabel(follow.notify_match_start)} disabled={pendingOverride} onChange={(value) => onOverride({ notifyMatchStart: value })} text={text} /><OverrideSelect label={text.matchResultShort} value={overrideLabel(follow.notify_match_result)} disabled={pendingOverride} onChange={(value) => onOverride({ notifyMatchResult: value })} text={text} /></div>
    <Button variant="ghost" size="icon-xs" disabled={pending || pendingOverride} onClick={onRemove} title={text.unfollow} aria-label={`${text.unfollow}: ${label}`}>{pending ? <Loader2Icon className="animate-spin" /> : <XIcon />}</Button>
  </div>;
}

function OverrideSelect({ label, value, disabled, onChange, text }: { label: string; value: FollowOverride; disabled: boolean; onChange: (value: FollowOverride) => void; text: FollowsCopy }) {
  return <label className="flex min-w-0 items-center gap-1"><span className="sr-only">{label}</span><select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as FollowOverride)} className="h-7 max-w-24 rounded-md border border-input bg-transparent px-1 text-xs disabled:opacity-50"><option value="inherit">{label}: {text.inherit}</option><option value="on">{label}: {text.on}</option><option value="off">{label}: {text.off}</option></select></label>;
}

function PrefRow({ label, help, on, disabled, onToggle }: { label: string; help: string; on: boolean; disabled: boolean; onToggle: (next: boolean) => void }) {
  return <div className="flex items-start justify-between gap-3 rounded-lg border border-border/50 px-3 py-2.5"><div className="min-w-0"><div className="text-sm font-medium">{label}</div><div className="text-xs text-muted-foreground">{help}</div></div><Toggle pressed={on} disabled={disabled} onPressedChange={onToggle} aria-label={label} variant="outline" size="sm" className="shrink-0 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">{disabled ? <Loader2Icon className="size-3.5 animate-spin" /> : on ? <BellIcon className="size-3.5" /> : <BellOffIcon className="size-3.5" />}</Toggle></div>;
}
