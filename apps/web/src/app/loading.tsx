import { Loader2Icon } from "lucide-react";
import { copy } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";

export default async function Loading() {
  const locale = await getRequestLocale();
  const text = copy[locale].common;
  return (
    <main className="mx-auto flex w-full flex-1 flex-col items-center justify-center gap-3 px-5 py-20 text-muted-foreground">
      <Loader2Icon className="size-6 animate-spin" aria-hidden />
      <p className="text-sm">{text.loadingLabel}</p>
    </main>
  );
}
