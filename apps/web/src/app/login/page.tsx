import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { TrophyIcon } from "lucide-react";
import { LoginPanel } from "@/components/dashboard/login-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { copy, localizedPath } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function LoginPage() {
  const locale = await getRequestLocale();
  const text = copy[locale].common;

  return (
    <main className="flex min-h-svh flex-1 flex-col items-center justify-center gap-6 bg-muted px-6 py-10 md:px-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Link
          href={localizedPath("/", locale)}
          className="flex items-center gap-2 self-center font-medium"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <TrophyIcon className="size-4" />
          </span>
          <span>{text.brand}</span>
        </Link>
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <LoginPanel locale={locale} />
        </Suspense>
      </div>
    </main>
  );
}
