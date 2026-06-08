import { Suspense } from "react";
import { LoginPanel } from "@/components/dashboard/login-panel";
import { Skeleton } from "@/components/ui/skeleton";
import {
  directionForLocale,
  localeFromSearchParams,
} from "@/lib/i18n";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const locale = localeFromSearchParams(await searchParams);

  return (
    <main
      lang={locale}
      dir={directionForLocale(locale)}
      className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8"
    >
      <Suspense fallback={<Skeleton className="h-56 w-full max-w-md" />}>
        <LoginPanel />
      </Suspense>
    </main>
  );
}
