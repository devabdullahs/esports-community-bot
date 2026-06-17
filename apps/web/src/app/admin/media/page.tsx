import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { MediaList } from "@/components/admin/media-list";
import { getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { listMediaChannels } from "@/lib/media";
import { getRequestLocale } from "@/lib/request-locale";
import { Button } from "@/components/ui/button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminMediaPage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/media");
  if (!access.allowed) redirect("/admin");
  const locale = await getRequestLocale();
  const t = getAdminCopy(locale);

  const channels = await listMediaChannels();
  const editableSlugs =
    access.media === "ALL" ? channels.map((c) => c.slug) : access.media;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-5 py-10 sm:px-8">
      <Button render={<Link href="/admin" />} nativeButton={false} variant="ghost" className="w-fit">
        <ArrowLeftIcon data-icon="inline-start" />
        {t.common.backToAdmin}
      </Button>
      <div>
        <p className="text-sm text-muted-foreground">{t.common.adminPublishing}</p>
        <h1 className="text-3xl font-semibold leading-tight">{t.media.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {access.isSuper ? t.media.descriptionSuper : t.media.descriptionScoped}
        </p>
      </div>
      <MediaList
        channels={channels}
        isSuper={access.isSuper}
        editableSlugs={editableSlugs}
        locale={locale}
      />
    </main>
  );
}
