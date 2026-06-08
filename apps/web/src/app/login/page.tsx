import { Suspense } from "react";
import { LoginPanel } from "@/components/dashboard/login-panel";
import { Skeleton } from "@/components/ui/skeleton";

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-10">
      <Suspense fallback={<Skeleton className="h-56 w-full max-w-md" />}>
        <LoginPanel />
      </Suspense>
    </main>
  );
}
