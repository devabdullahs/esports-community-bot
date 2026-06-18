import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { CommentModeration } from "@/components/admin/comment-moderation";
import { getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { getRequestLocale } from "@/lib/request-locale";
import { Button } from "@/components/ui/button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminCommentsPage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/comments");
  if (!access.allowed) redirect("/admin");
  const locale = await getRequestLocale();
  const t = getAdminCopy(locale);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-5 py-10 sm:px-8">
      <Button render={<Link href="/admin" />} nativeButton={false} variant="ghost" className="w-fit">
        <ArrowLeftIcon data-icon="inline-start" />
        {t.common.backToAdmin}
      </Button>
      <div>
        <p className="text-sm text-muted-foreground">{t.common.moderation}</p>
        <h1 className="text-3xl font-semibold leading-tight">{t.comments.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.comments.description}
        </p>
      </div>
      <CommentModeration locale={locale} />
    </main>
  );
}
