import { Suspense } from "react";
import { LoginPanel } from "@/components/dashboard/login-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { getRequestLocale } from "@/lib/request-locale";

export default async function LoginPage() {
  const locale = await getRequestLocale();

  return (
    <main
      className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8"
    >
      <Suspense fallback={<Skeleton className="h-56 w-full max-w-md" />}>
        <LoginPanel locale={locale} />
      </Suspense>
    </main>
  );
}
