"use client";

import Link from "next/link";
import { useState } from "react";
import { BellIcon, BellRingIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copy, localizedPath, type Locale } from "@/lib/i18n";
import { trackProductEvent } from "@/lib/product-analytics";

// FollowEntityType lives in lib/follows.ts (server-only); mirror the union here
// so the client bundle never imports the DB boundary.
type EntityType = "game" | "tournament" | "team" | "player";

export function FollowButton({
  entityType,
  entityKey,
  entityLabel,
  entityRef,
  signedIn,
  initialFollowing,
  locale,
  callbackPath,
}: {
  entityType: EntityType;
  entityKey: string;
  entityLabel: string;
  entityRef: string;
  signedIn: boolean;
  initialFollowing: boolean;
  locale: Locale;
  /** Where to return after login (the current entity page). */
  callbackPath: string;
}) {
  const text = copy[locale].follows;
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);

  if (!signedIn) {
    const loginParams = new URLSearchParams({ callbackURL: callbackPath });
    return (
      <Button
        render={<Link href={`${localizedPath("/login", locale)}?${loginParams.toString()}`} />}
        nativeButton={false}
        variant="outline"
        size="sm"
      >
        <BellIcon data-icon="inline-start" />
        {text.signInToFollow}
      </Button>
    );
  }

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const next = !following;
    setFollowing(next); // optimistic; reverted on failure
    try {
      const res = await fetch("/api/me/follows", {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType, entityKey, entityLabel, entityRef }),
      });
      if (!res.ok) {
        setFollowing(!next);
      } else if (next) {
        trackProductEvent("follow_create");
      } else {
        trackProductEvent("follow_remove");
      }
    } catch {
      setFollowing(!next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant={following ? "default" : "outline"}
      size="sm"
      disabled={busy}
      onClick={toggle}
      title={following ? text.unfollow : text.follow}
    >
      {busy ? (
        <Loader2Icon data-icon="inline-start" className="animate-spin" />
      ) : following ? (
        <BellRingIcon data-icon="inline-start" />
      ) : (
        <BellIcon data-icon="inline-start" />
      )}
      {following ? text.following : text.follow}
    </Button>
  );
}
