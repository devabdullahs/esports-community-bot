import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { StreamChannelsManager } from "@/components/admin/stream-channels-manager";
import { getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { getRequestLocale } from "@/lib/request-locale";
import { listStreamChannels } from "@/lib/stream-channels";
import { Button } from "@/components/ui/button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminStreamsPage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/streams");
  if (!access.isSuper) redirect("/admin");

  const locale = await getRequestLocale();
  const t = getAdminCopy(locale);
  const channels = await listStreamChannels();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-5 py-10 sm:px-8">
      <Button render={<Link href="/admin" />} nativeButton={false} variant="ghost" className="w-fit">
        <ArrowLeftIcon data-icon="inline-start" />
        {t.common.backToAdmin}
      </Button>
      <div>
        <p className="text-sm text-muted-foreground">{t.common.adminPublishing}</p>
        <h1 className="text-3xl font-semibold leading-tight">Co-streams</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Curate live Twitch / Kick / YouTube / SOOP channels. Attach a channel to a whole game, a team,
          a single match, or the official EWC list. Live status and embeds come next — these lists drive them.
        </p>
      </div>
      <StreamChannelsManager channels={channels} />
    </main>
  );
}
