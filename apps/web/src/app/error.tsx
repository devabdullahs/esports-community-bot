"use client";

import { useEffect, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copy, LOCALE_COOKIE_NAME, type Locale } from "@/lib/i18n";

// error.tsx must be a client component, so it reads the locale from the cookie
// (the layout still provides header/footer + html dir around it).
function readLocale(): Locale {
  if (typeof document === "undefined") return "en";
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE_NAME}=(ar|en)`));
  return (match?.[1] as Locale) || "en";
}

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Lazy initializer reads the cookie once on the client (avoids setState-in-effect).
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
