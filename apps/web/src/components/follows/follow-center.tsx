"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  BellIcon,
  BellOffIcon,
  CheckIcon,
  CheckCheckIcon,
  FlagIcon,
  Gamepad2Icon,
  Loader2Icon,
  MessageCircleIcon,
  PlayIcon,
  ShieldIcon,
  TrophyIcon,
  UserIcon,
  XIcon,
} from "lucide-react";
import { DateTime } from "@/components/date-time";
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
import { cn } from "@/lib/utils";

type EntityType = "game" | "tournament" | "team" | "player";

type FollowRow = {
  id: number;
  entity_type: EntityType;
  entity_key: string;
  entity_label: string;
  entity_ref: string;
};

type NotificationRow = {
  id: number;
  type: "match_start" | "match_result";
  title: string;
  body: string;
  url: string;
  read_at: string | null;
  created_at: string;
};

type Prefs = {
  dm_enabled: number;
  notify_match_start: number;
  notify_match_result: number;
};

const TYPE_ICONS: Record<EntityType, typeof Gamepad2Icon> = {
  game: Gamepad2Icon,
  tournament: TrophyIcon,
  team: ShieldIcon,
  player: UserIcon,
};

export function FollowCenter({ locale }: { locale: Locale }) {
  const text = copy[locale].follows;
  const [follows, setFollows] = useState<FollowRow[] | null>(null);
  const [notifications, setNotifications] = useState<NotificationRow[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingReadIds, setPendingReadIds] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [followsRes, notificationsRes, prefsRes] = await Promise.all([
          fetch("/api/me/follows"),
          fetch("/api/me/notifications?limit=20"),
          fetch("/api/me/notification-prefs"),
        ]);
        if (cancelled) return;
        if (!followsRes.ok || !notificationsRes.ok || !prefsRes.ok) {
          setError(text.loadFailed);
          return;
        }
        const followsData = await followsRes.json();
        const notificationsData = await notificationsRes.json();
        const prefsData = await prefsRes.json();
        if (cancelled) return;
        setFollows(followsData.follows ?? []);
        setNotifications(notificationsData.notifications ?? []);
        setUnread(notificationsData.unread ?? 0);
        setPrefs(prefsData.prefs ?? null);
      } catch {
        if (!cancelled) setError(text.loadFailed);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // Loads once per mount; copy is stable for the page's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function unfollow(row: FollowRow) {
    setBusy(true);
    try {
      const res = await fetch("/api/me/follows", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType: row.entity_type, entityKey: row.entity_key }),
      });
      if (res.ok) setFollows((prev) => (prev ?? []).filter((f) => f.id !== row.id));
      else setError(text.updateFailed);
    } finally {
      setBusy(false);
    }
  }

  async function markAllRead() {
    setBusy(true);
    try {
      const res = await fetch("/api/me/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      if (res.ok) {
        setUnread(0);
        setNotifications((prev) =>
          (prev ?? []).map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function markNotificationRead(notification: NotificationRow) {
    if (notification.read_at || pendingReadIds.has(notification.id)) return;
    const readAt = new Date().toISOString();
    setPendingReadIds((prev) => new Set(prev).add(notification.id));
    setUnread((prev) => Math.max(0, prev - 1));
    setNotifications((prev) =>
      (prev ?? []).map((item) =>
        item.id === notification.id ? { ...item, read_at: item.read_at ?? readAt } : item,
      ),
    );

    try {
      const res = await fetch("/api/me/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: notification.id }),
        keepalive: true,
      });
      if (!res.ok) throw new Error("mark-read failed");
    } catch {
      setError(text.updateFailed);
      setUnread((prev) => prev + 1);
      setNotifications((prev) =>
        (prev ?? []).map((item) =>
          item.id === notification.id && item.read_at === readAt ? { ...item, read_at: null } : item,
        ),
      );
    } finally {
      setPendingReadIds((prev) => {
        const next = new Set(prev);
        next.delete(notification.id);
        return next;
      });
    }
  }

  async function updatePref(patch: { dmEnabled?: boolean; notifyMatchStart?: boolean; notifyMatchResult?: boolean }) {
    if (!prefs) return;
    setBusy(true);
    try {
      const res = await fetch("/api/me/notification-prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.prefs) setPrefs(data.prefs);
      else setError(text.updateFailed);
    } finally {
      setBusy(false);
    }
  }

  const loading = follows === null || notifications === null || prefs === null;

  return (
    <section className="grid gap-6 lg:grid-cols-2">
      <Card className="lg:col-span-2">
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
            {unread > 0 ? (
              <Button variant="outline" size="sm" disabled={busy} onClick={markAllRead}>
                <CheckCheckIcon data-icon="inline-start" />
                {text.markAllRead}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {loading && !error ? <Loader2Icon className="size-4 animate-spin text-muted-foreground" /> : null}
          {!loading && notifications && notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground">{text.noNotifications}</p>
          ) : null}
          {(notifications ?? []).map((n) => {
            const pendingRead = pendingReadIds.has(n.id);
            const contentClassName = cn(
              "flex min-w-0 flex-1 flex-wrap items-center gap-2 rounded-md px-2.5 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring",
              n.url && (n.read_at ? "hover:bg-muted/30" : "hover:bg-primary/10"),
            );
            const content = (
              <>
                {n.type === "match_start" ? (
                  <PlayIcon className="size-3.5 shrink-0 text-destructive" />
                ) : (
                  <FlagIcon className="size-3.5 shrink-0 text-primary" />
                )}
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {n.type === "match_start" ? text.matchStart : text.matchResult}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto">
                  {n.title}
                  {n.body ? <span className="text-muted-foreground"> · {n.body}</span> : null}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  <DateTime value={n.created_at} locale={locale} />
                </span>
              </>
            );

            return (
              <div
                key={n.id}
                className={cn(
                  "flex items-center gap-1 rounded-lg border p-0.5 transition-colors",
                  n.read_at
                    ? "border-border/50 bg-background/30"
                    : "border-primary/30 bg-primary/5",
                )}
              >
                {n.url ? (
                  <Link
                    href={n.url}
                    className={contentClassName}
                    aria-label={text.openNotification}
                    onClick={() => void markNotificationRead(n)}
                  >
                    {content}
                  </Link>
                ) : (
                  <div className={contentClassName}>{content}</div>
                )}
                {!n.read_at ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={busy || pendingRead}
                    title={text.markRead}
                    aria-label={`${text.markRead}: ${n.title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void markNotificationRead(n);
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellIcon className="size-4 text-primary" />
            {text.followingTitle}
          </CardTitle>
          <CardDescription>{text.followingDescription}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          {!loading && follows && follows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{text.noFollows}</p>
          ) : null}
          {(follows ?? []).map((f) => {
            const Icon = TYPE_ICONS[f.entity_type] ?? BellIcon;
            const label = f.entity_label || f.entity_key;
            return (
              <div key={f.id} className="flex items-center gap-2 rounded-lg border border-border/50 px-3 py-2">
                <Icon className="size-3.5 shrink-0 text-primary" />
                <Badge variant="outline">{text.entityTypes[f.entity_type]}</Badge>
                <span className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto">
                  {f.entity_ref ? (
                    <Link href={localizedPath(f.entity_ref, locale)} className="hover:underline">
                      {label}
                    </Link>
                  ) : (
                    label
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={busy}
                  onClick={() => unfollow(f)}
                  title={text.unfollow}
                  aria-label={`${text.unfollow}: ${label}`}
                >
                  <XIcon />
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircleIcon className="size-4 text-primary" />
            {text.settingsTitle}
          </CardTitle>
          <CardDescription>{text.settingsDescription}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {prefs ? (
            <>
              <PrefRow
                label={text.dmEnabled}
                help={text.dmEnabledHelp}
                on={Boolean(prefs.dm_enabled)}
                disabled={busy}
                onToggle={(next) => updatePref({ dmEnabled: next })}
              />
              <PrefRow
                label={text.notifyMatchStart}
                help={text.notifyMatchStartHelp}
                on={Boolean(prefs.notify_match_start)}
                disabled={busy}
                onToggle={(next) => updatePref({ notifyMatchStart: next })}
              />
              <PrefRow
                label={text.notifyMatchResult}
                help={text.notifyMatchResultHelp}
                on={Boolean(prefs.notify_match_result)}
                disabled={busy}
                onToggle={(next) => updatePref({ notifyMatchResult: next })}
              />
            </>
          ) : null}
        </CardContent>
      </Card>
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
        {on ? <BellIcon className="size-3.5" /> : <BellOffIcon className="size-3.5" />}
      </Toggle>
    </div>
  );
}
