import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountWorkspace } from "@/components/dashboard/account-workspace";
import { DEFAULT_SEASON } from "@/lib/env";
import { copy, localizedPath } from "@/lib/i18n";
import { normalizeProfileTab } from "@/lib/profile-workspace";
import { getRequestLocale } from "@/lib/request-locale";
import { getOptionalSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function MePage({
  searchParams,
}: {
  searchParams: Promise<{ guildId?: string; season?: string; tab?: string }>;
}) {
  const session = await getOptionalSession();
  const params = await searchParams;
  const locale = await getRequestLocale();
  const text = copy[locale].profile;
  const callbackParams = new URLSearchParams();
  if (params.guildId) callbackParams.set("guildId", params.guildId);
  callbackParams.set("season", params.season || DEFAULT_SEASON);
  if (params.tab) callbackParams.set("tab", normalizeProfileTab(params.tab));
  const callbackURL = localizedPath(`/me?${callbackParams.toString()}`, locale);

  if (!session) {
    const loginParams = new URLSearchParams({ callbackURL });
    redirect(localizedPath(`/login?${loginParams.toString()}`, locale));
  }

  return (
    <main
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-8 sm:px-8 sm:py-10"
    >
      <div className="flex max-w-3xl flex-col gap-2">
        <p className="text-sm text-muted-foreground">{text.eyebrow}</p>
        <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">
          {text.title}
        </h1>
      </div>
      <AccountWorkspace
        key={normalizeProfileTab(params.tab)}
        guildId={params.guildId}
        season={params.season || DEFAULT_SEASON}
        locale={locale}
        initialTab={normalizeProfileTab(params.tab)}
      />
    </main>
  );
}
