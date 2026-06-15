import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { MediaEditor } from "@/components/admin/media-editor";
import { canManageMedia, getAdminAccess } from "@/lib/admin";
import { listGames } from "@/lib/games";
import { getMediaChannel } from "@/lib/media";
import { getRequestLocale } from "@/lib/request-locale";
import { Button } from "@/components/ui/button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function EditMediaChannelPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const access = await getAdminAccess();
  if (!access.session) redirect(`/login?callbackURL=/admin/media/${slug}`);
  if (!access.allowed) redirect("/admin");
  if (!canManageMedia(access, slug)) redirect("/admin/media");

  const channel = await getMediaChannel(slug);
  if (!channel) notFound();
  const locale = await getRequestLocale();
  const games = (await listGames()).map((g) => ({ slug: g.slug, name: g.title[locale] || g.title.en || g.slug }));

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-5 py-10 sm:px-8">
      <Button render={<Link href="/admin/media" />} nativeButton={false} variant="ghost" className="w-fit">
        <ArrowLeftIcon data-icon="inline-start" />
        Back to channels
      </Button>
      <div>
        <p className="text-sm text-muted-foreground">Admin publishing</p>
        <h1 className="text-3xl font-semibold leading-tight">Edit media channel</h1>
      </div>
      <MediaEditor mode="edit" channel={channel} games={games} locale={locale} />
    </main>
  );
}
