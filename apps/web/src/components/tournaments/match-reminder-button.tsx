"use client";

import Link from "next/link";
import { BellIcon, BellRingIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { copy, localizedPath, type Locale } from "@/lib/i18n";

type ToggleRequest = (active: boolean) => Promise<void>;

export async function runOptimisticReminderToggle(
  active: boolean,
  setActive: (active: boolean) => void,
  request: ToggleRequest,
) {
  const next = !active;
  setActive(next);
  try {
    await request(next);
  } catch (error) {
    setActive(active);
    throw error;
  }
  return next;
}

export function MatchReminderButton({
  matchId,
  signedIn,
  initialReminded,
  locale,
  callbackPath,
}: {
  matchId: number;
  signedIn: boolean;
  initialReminded: boolean;
  locale: Locale;
  callbackPath: string;
}) {
  const text = copy[locale].tournaments;
  const [reminded, setReminded] = useState(initialReminded);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = reminded ? text.cancelReminder : text.remindMe;

  if (!signedIn) {
    const loginParams = new URLSearchParams({ callbackURL: callbackPath });
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              render={<Link href={`${localizedPath("/login", locale)}?${loginParams.toString()}`} />}
              nativeButton={false}
              variant="ghost"
              size="icon-sm"
              aria-label={text.signInToSetReminder}
            />
          }
        >
          <BellIcon aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent dir={locale === "ar" ? "rtl" : "ltr"}>{text.signInToSetReminder}</TooltipContent>
      </Tooltip>
    );
  }

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await runOptimisticReminderToggle(reminded, setReminded, async (next) => {
        const response = await fetch("/api/me/match-reminders", {
          method: next ? "POST" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchId }),
        });
        if (!response.ok) throw new Error("Match reminder request failed.");
      });
    } catch {
      setError(text.reminderFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant={reminded ? "default" : "ghost"}
              size="icon-sm"
              disabled={busy}
              aria-label={label}
              aria-pressed={reminded}
              aria-busy={busy || undefined}
              onClick={toggle}
            />
          }
        >
          {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : reminded ? <BellRingIcon aria-hidden="true" /> : <BellIcon aria-hidden="true" />}
        </TooltipTrigger>
        <TooltipContent dir={locale === "ar" ? "rtl" : "ltr"}>{label}</TooltipContent>
      </Tooltip>
      {error ? <span role="alert" className="max-w-36 text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
