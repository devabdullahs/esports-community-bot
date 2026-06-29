"use client";

import { RefreshCwIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { directionForLocale, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 60_000;

const COPY = {
  en: {
    title: "New update available",
    description: "A newer version of the site is ready. Refresh to load the latest changes.",
    refresh: "Refresh",
    dismiss: "Dismiss update notice",
  },
  ar: {
    title: "تحديث جديد متاح",
    description: "نسخة أحدث من الموقع جاهزة. حدّث الصفحة لتحميل آخر التغييرات.",
    refresh: "تحديث الصفحة",
    dismiss: "إخفاء تنبيه التحديث",
  },
} satisfies Record<Locale, Record<string, string>>;

type VersionResponse = {
  version?: string;
};

function normalizeVersion(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function DeploymentUpdateAlert({
  initialVersion,
  locale,
}: {
  initialVersion: string;
  locale: Locale;
}) {
  const copy = COPY[locale];
  const isRtl = directionForLocale(locale) === "rtl";
  const currentVersionRef = useRef(normalizeVersion(initialVersion));
  const checkingRef = useRef(false);
  const [available, setAvailable] = useState(false);

  const checkForUpdate = useCallback(async () => {
    if (checkingRef.current || available) return;
    checkingRef.current = true;
    try {
      const response = await fetch(`/api/deployment-version?t=${Date.now()}`, {
        cache: "no-store",
        // Public, unauthenticated endpoint: do not send the session cookie on the poll.
        credentials: "omit",
      });
      if (!response.ok) return;
      const data = (await response.json()) as VersionResponse;
      const nextVersion = normalizeVersion(data.version);
      if (nextVersion && currentVersionRef.current && nextVersion !== currentVersionRef.current) {
        setAvailable(true);
      }
    } catch {
      // A transient network error should not disturb the page.
    } finally {
      checkingRef.current = false;
    }
  }, [available]);

  useEffect(() => {
    const timer = window.setInterval(checkForUpdate, POLL_INTERVAL_MS);
    const onFocus = () => void checkForUpdate();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkForUpdate();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [checkForUpdate]);

  if (!available) return null;

  return (
    <div
      className={cn(
        "pointer-events-none fixed bottom-4 z-50 w-[calc(100vw-2rem)] max-w-sm sm:bottom-6",
        isRtl ? "left-4 sm:left-6" : "right-4 sm:right-6",
      )}
      dir={isRtl ? "rtl" : "ltr"}
    >
      <Alert
        aria-live="polite"
        className="pointer-events-auto border-primary/40 bg-background/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/85"
      >
        <RefreshCwIcon />
        <AlertTitle>{copy.title}</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>{copy.description}</span>
          <Button type="button" size="sm" className="w-fit" onClick={() => window.location.reload()}>
            <RefreshCwIcon data-icon="inline-start" />
            {copy.refresh}
          </Button>
        </AlertDescription>
        <AlertAction>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={copy.dismiss}
            onClick={() => setAvailable(false)}
          >
            <XIcon />
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}
