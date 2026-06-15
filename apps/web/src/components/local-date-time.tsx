"use client";

import { useSyncExternalStore } from "react";
import {
  dateTimeIso,
  formatDateTime,
  type DateTimeValue,
  type Locale,
} from "@/lib/i18n";

export function LocalDateTime({
  value,
  locale,
  fallback = "",
  className,
}: {
  value: DateTimeValue;
  locale: Locale;
  fallback?: string;
  className?: string;
}) {
  const hasHydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const iso = dateTimeIso(value);
  const label = hasHydrated ? formatDateTime(value, locale) : fallback;

  return (
    <time
      className={className}
      dateTime={iso}
      title={iso}
      suppressHydrationWarning
    >
      {label || fallback}
    </time>
  );
}
