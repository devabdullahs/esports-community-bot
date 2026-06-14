import { redirect } from "next/navigation";
import { ProfileDashboard } from "@/components/dashboard/profile-dashboard";
import { SignOutButton } from "@/components/dashboard/sign-out-button";
import { DEFAULT_SEASON } from "@/lib/env";
import { copy, localizedPath } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";
import { getOptionalSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function MePage({
  searchParams,
}: {
  searchParams: Promise<{ guildId?: string; season?: string }>;
}) {
  const session = await getOptionalSession();
  const params = await searchParams;
  const locale = await getRequestLocale();
  const text = copy[locale].profile;
  const common = copy[locale].common;
  const callbackParams = new URLSearchParams();
  if (params.guildId) callbackParams.set("guildId", params.guildId);
  callbackParams.set("season", params.season || DEFAULT_SEASON);
  const callbackURL = `/me?${callbackParams.toString()}`;

  if (!session) {
    const loginParams = new URLSearchParams({ callbackURL });
    redirect(`/login?${loginParams.toString()}`);
  }

  return (
    <main
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-5 py-10 sm:px-8"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-3xl flex-col gap-2">
          <p className="text-sm text-muted-foreground">{text.eyebrow}</p>
          <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">
            {text.title}
          </h1>
        </div>
        <SignOutButton
          label={common.signOut}
          redirectTo={localizedPath("/", locale)}
        />
      </div>
      <ProfileDashboard guildId={params.guildId} season={params.season || DEFAULT_SEASON} locale={locale} />
    </main>
  );
}
