import { redirect } from "next/navigation";
import { CommentModeration } from "@/components/admin/comment-moderation";
import { getAdminAccess } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminCommentsPage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/comments");
  if (!access.allowed) redirect("/admin");

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-5 py-10 sm:px-8">
      <div>
        <p className="text-sm text-muted-foreground">Moderation</p>
        <h1 className="text-3xl font-semibold leading-tight">Comments</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review flagged and pending comments. Every action is recorded in the audit log.
        </p>
      </div>
      <CommentModeration />
    </main>
  );
}
