"use client";

import Link, { useLinkStatus } from "next/link";
import type { ComponentProps } from "react";
import { useLoadingElapsed } from "@/components/use-loading-elapsed";

function PendingFeedback({ arabic }: { arabic: boolean }) {
  const elapsed = useLoadingElapsed();
  return (
    <span className="ec-navigation-feedback" role="status" aria-live="polite">
      <span className="ec-loading-spinner" aria-hidden="true" />
      <span>{arabic ? "جارٍ فتح الصفحة…" : "Opening page…"}</span>
      <span aria-hidden="true" className="tabular-nums">{elapsed}{arabic ? " ث" : "s"}</span>
    </span>
  );
}

function NavigationFeedback({ arabic }: { arabic: boolean }) {
  const { pending } = useLinkStatus();
  return pending ? <PendingFeedback arabic={arabic} /> : null;
}

export function NavigationLink({ children, ...props }: ComponentProps<typeof Link>) {
  const path = typeof props.href === "string" ? props.href : props.href.pathname ?? "";
  return (
    <Link {...props}>
      {children}
      <NavigationFeedback arabic={path === "/ar" || path.startsWith("/ar/")} />
    </Link>
  );
}
