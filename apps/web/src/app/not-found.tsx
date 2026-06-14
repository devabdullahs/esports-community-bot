import Link from "next/link";
import { HomeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copy, localizedPath } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";

export default async function NotFound() {
  const locale = await getRequestLocale();
  const text = copy[locale].common;
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-5 py-20 text-center">
      <p className="text-5xl font-semibold text-muted-foreground tabular-nums">404</p>
      <h1 className="text-2xl font-semibold">{text.notFoundTitle}</h1>
      <p className="text-sm leading-6 text-muted-foreground">{text.notFoundBody}</p>
      <Button render={<Link href={localizedPath("/", locale)} />} nativeButton={false} className="mt-2">
        <HomeIcon data-icon="inline-start" />
        {text.home}
      </Button>
    </main>
  );
}
