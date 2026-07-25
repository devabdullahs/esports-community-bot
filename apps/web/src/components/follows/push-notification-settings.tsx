"use client";

import { BellRingIcon, BellOffIcon, Loader2Icon, SmartphoneIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { copy, type Locale } from "@/lib/i18n";

type PushApiState = {
  enabled: boolean;
  publicKey: string | null;
  subscriptions: Array<{ id: string; created_at: string; updated_at: string }>;
};

type PushState = "loading" | "unsupported" | "unavailable" | "denied" | "inactive" | "active" | "working" | "error";

function applicationServerKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function supportsPush() {
  return "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

async function getServerState(signal?: AbortSignal) {
  const response = await fetch("/api/me/push-subscriptions", { cache: "no-store", signal });
  if (!response.ok) throw new Error(`Push settings request failed (${response.status}).`);
  return response.json() as Promise<PushApiState>;
}

async function activeBrowserSubscription() {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration?.pushManager.getSubscription() ?? null;
}

export function PushNotificationSettings({ locale }: { locale: Locale }) {
  const text = copy[locale].follows;
  const [state, setState] = useState<PushState>("loading");
  const [server, setServer] = useState<PushApiState | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!supportsPush()) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    try {
      const nextServer = await getServerState(signal);
      setServer(nextServer);
      if (!nextServer.enabled || !nextServer.publicKey) {
        setState("unavailable");
        return;
      }
      const browserSubscription = await activeBrowserSubscription();
      setState(browserSubscription && nextServer.subscriptions.length > 0 ? "active" : "inactive");
    } catch (error) {
      if ((error as { name?: string }).name !== "AbortError") setState("error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => void refresh(controller.signal), 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [refresh]);

  async function enable() {
    if (!server?.publicKey || state === "working") return;
    setState("working");
    try {
      const permission = Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "inactive");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(server.publicKey),
      });
      const payload = subscription.toJSON();
      if (!payload.endpoint || !payload.keys?.p256dh || !payload.keys.auth) throw new Error("Incomplete browser subscription.");
      const response = await fetch("/api/me/push-subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`Push subscription failed (${response.status}).`);
      setServer(await getServerState());
      setState("active");
    } catch {
      setState("error");
    }
  }

  async function disable() {
    if (state === "working") return;
    setState("working");
    try {
      const subscription = await activeBrowserSubscription();
      if (subscription) {
        const response = await fetch("/api/me/push-subscriptions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        if (!response.ok && response.status !== 404) throw new Error(`Push unsubscribe failed (${response.status}).`);
        await subscription.unsubscribe();
      }
      setServer(await getServerState());
      setState("inactive");
    } catch {
      setState("error");
    }
  }

  const active = state === "active";
  const busy = state === "loading" || state === "working";
  const statusLabel = active
    ? text.browserPushActive
    : state === "denied"
      ? text.browserPushDenied
      : state === "unsupported"
        ? text.browserPushUnsupported
        : state === "unavailable"
          ? text.browserPushUnavailable
          : text.browserPushInactive;

  return (
    <div className="mt-1 border-t border-border/70 pt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <SmartphoneIcon className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium">{text.browserPushTitle}</h3>
              <Badge variant={active ? "default" : "secondary"}>{statusLabel}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{text.browserPushDescription}</p>
            <p className="mt-1 text-xs text-muted-foreground">{text.browserPushQuietHours}</p>
            {state === "error" && <p className="mt-1 text-xs text-destructive" role="alert">{text.browserPushFailed}</p>}
          </div>
        </div>
        {state !== "unsupported" && state !== "unavailable" && state !== "denied" && (
          <Button
            type="button"
            variant={active ? "outline" : "default"}
            size="sm"
            disabled={busy}
            onClick={active ? disable : enable}
            className="shrink-0"
          >
            {busy
              ? <Loader2Icon className="animate-spin" />
              : active
                ? <BellOffIcon />
                : <BellRingIcon />}
            {active ? text.browserPushDisable : text.browserPushEnable}
          </Button>
        )}
      </div>
    </div>
  );
}
