import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { MediaEditor } from "@/components/admin/media-editor";
import { getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { getRequestLocale } from "@/lib/request-locale";
import { Button } from "@/components/ui/button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NewMediaChannelPage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/media/new");
  if (!access.isSuper) redirect("/admin/media");
  const locale = await getRequestLocale();
  const t = getAdminCopy(locale);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-5 py-10 sm:px-8">
      <Button render={<Link href="/admin/media" />} nativeButton={false} variant="ghost" className="w-fit">
        <ArrowLeftIcon data-icon="inline-start" />
        {t.common.backToChannels}
      </Button>
      <div>
        <p className="text-sm text-muted-foreground">{t.common.adminPublishing}</p>
        <h1 className="text-3xl font-semibold leading-tight">{t.media.newTitle}</h1>
      </div>
      <MediaEditor mode="create" locale={locale} />
    </main>
  );
}
