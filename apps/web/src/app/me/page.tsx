import { redirect } from "next/navigation";
import { ProfileDashboard } from "@/components/dashboard/profile-dashboard";
import { DEFAULT_SEASON } from "@/lib/env";
import {
  copy,
  directionForLocale,
  localeFromSearchParams,
} from "@/lib/i18n";
import { getOptionalSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function MePage({
  searchParams,
}: {
  searchParams: Promise<{ guildId?: string; season?: string; lang?: string }>;
}) {
  const session = await getOptionalSession();
  const params = await searchParams;
  const locale = localeFromSearchParams(params);
  const text = copy[locale].profile;
  const callbackParams = new URLSearchParams();
  if (params.guildId) callbackParams.set("guildId", params.guildId);
  callbackParams.set("season", params.season || DEFAULT_SEASON);
  if (locale === "ar") callbackParams.set("lang", locale);
  const callbackURL = `/me?${callbackParams.toString()}`;

  if (!session) {
    const loginParams = new URLSearchParams({ callbackURL });
    if (locale === "ar") loginParams.set("lang", locale);
    redirect(`/login?${loginParams.toString()}`);
  }

  return (
    <main
      lang={locale}
      dir={directionForLocale(locale)}
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-5 py-10 sm:px-8"
    >
      <div className="flex max-w-3xl flex-col gap-2">
        <p className="text-sm text-muted-foreground">{text.eyebrow}</p>
        <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">
          {text.title}
        </h1>
      </div>
      <ProfileDashboard guildId={params.guildId} season={params.season || DEFAULT_SEASON} locale={locale} />
    </main>
  );
}
