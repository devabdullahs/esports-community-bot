import { redirect } from "next/navigation";
import { ProfileDashboard } from "@/components/dashboard/profile-dashboard";
import { DEFAULT_SEASON } from "@/lib/env";
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
  const callbackParams = new URLSearchParams();
  if (params.guildId) callbackParams.set("guildId", params.guildId);
  callbackParams.set("season", params.season || DEFAULT_SEASON);
  const callbackURL = `/me?${callbackParams.toString()}`;

  if (!session) {
    redirect(`/login?callbackURL=${encodeURIComponent(callbackURL)}`);
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
      <div>
        <p className="text-sm text-muted-foreground">EWC dashboard</p>
        <h1 className="text-3xl font-semibold tracking-normal">My prediction profile</h1>
      </div>
      <ProfileDashboard guildId={params.guildId} season={params.season || DEFAULT_SEASON} />
    </main>
  );
}
