import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { MediaList } from "@/components/admin/media-list";
import { getAdminAccess } from "@/lib/admin";
import { listMediaChannels } from "@/lib/media";
import { Button } from "@/components/ui/button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminMediaPage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/media");
  if (!access.allowed) redirect("/admin");

  const channels = await listMediaChannels();
  const editableSlugs =
    access.media === "ALL" ? channels.map((c) => c.slug) : access.media;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-5 py-10 sm:px-8">
      <Button render={<Link href="/admin" />} nativeButton={false} variant="ghost" className="w-fit">
        <ArrowLeftIcon data-icon="inline-start" />
        Back to admin
      </Button>
      <div>
        <p className="text-sm text-muted-foreground">Admin publishing</p>
        <h1 className="text-3xl font-semibold leading-tight">Media channels</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The esports media accounts shown in the public directory.
          {access.isSuper ? " Create, edit, reorder, or remove channels." : " You can edit your assigned channels."}
        </p>
      </div>
      <MediaList channels={channels} isSuper={access.isSuper} editableSlugs={editableSlugs} />
    </main>
  );
}
