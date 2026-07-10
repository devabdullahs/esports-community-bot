"use client";

import { useEffect, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copy, localeFromPathname, type Locale } from "@/lib/i18n";

function readLocale(): Locale {
  if (typeof window === "undefined") return "en";
  return localeFromPathname(window.location.pathname) ?? "en";
}

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // The route prefix is authoritative, including inside the client error boundary.
  const [locale] = useState<Locale>(readLocale);
  useEffect(() => {
    // Log for debugging; no external error reporting per scope.
    console.error(error);
  }, [error]);
  const text = copy[locale].common;
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-5 py-20 text-center">
      <h1 className="text-2xl font-semibold">{text.errorTitle}</h1>
      <p className="text-sm leading-6 text-muted-foreground">{text.errorBody}</p>
      <Button onClick={() => reset()} className="mt-2">
        <RefreshCwIcon data-icon="inline-start" />
        {text.retry}
      </Button>
    </main>
  );
}
