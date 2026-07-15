import { Suspense } from "react";
import type { Metadata } from "next";
import { LoginPanel } from "@/components/dashboard/login-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { copy } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return {
    title: copy[locale].login.metadataTitle,
    robots: { index: false, follow: true },
  };
}

export default async function LoginPage() {
  const locale = await getRequestLocale();

  return (
    <main className="flex flex-1">
      <div className="mx-auto flex w-full max-w-6xl flex-1 items-center px-4 py-10 sm:px-8 sm:py-14">
        <Suspense fallback={<Skeleton className="mx-auto h-96 w-full max-w-lg rounded-xl" />}>
          <LoginPanel locale={locale} />
        </Suspense>
      </div>
    </main>
  );
}
