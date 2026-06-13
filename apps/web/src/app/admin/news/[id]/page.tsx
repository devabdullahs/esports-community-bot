import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { NewsEditor } from "@/components/admin/news-editor";
import { canManageGame, getAdminAccess } from "@/lib/admin";
import { listGames } from "@/lib/games";
import { getNewsPost } from "@/lib/news";
import { parsePostId } from "@/lib/news-validation";
import { getRequestLocale } from "@/lib/request-locale";
import { Button } from "@/components/ui/button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function EditNewsPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const access = await getAdminAccess();
  if (!access.session) redirect(`/login?callbackURL=/admin/news/${id}`);
  if (!access.allowed) redirect("/admin");

  const postId = parsePostId(id);
  if (postId === null) notFound();
  const post = getNewsPost(postId);
  if (!post) notFound();
  if (!canManageGame(access, post.gameSlug)) redirect("/admin");

  const allGames = listGames();
  const games =
    access.games === "ALL" ? allGames : allGames.filter((g) => access.games.includes(g.slug));
  const locale = await getRequestLocale();

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-5 py-10 sm:px-8">
      <Button
        render={<Link href="/admin" />}
        nativeButton={false}
        variant="ghost"
        className="w-fit"
      >
        <ArrowLeftIcon data-icon="inline-start" />
        Back to admin
      </Button>
      <div>
        <p className="text-sm text-muted-foreground">Admin publishing</p>
        <h1 className="text-3xl font-semibold leading-tight">Edit post</h1>
      </div>
      <NewsEditor
        mode="edit"
        post={post}
        games={games}
        locale={locale}
        currentUser={{ discordId: access.discordUserId, name: access.displayName }}
      />
    </main>
  );
}
