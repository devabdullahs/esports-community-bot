import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { NewsEditor } from "@/components/admin/news-editor";
import { getAdminAccess } from "@/lib/admin";
import { listGames } from "@/lib/games";
import { getRequestLocale } from "@/lib/request-locale";
import { Button } from "@/components/ui/button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NewNewsPostPage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/news/new");
  if (!access.allowed) redirect("/admin");

  const allGames = listGames();
  const games =
    access.games === "ALL" ? allGames : allGames.filter((g) => access.games.includes(g.slug));
  if (games.length === 0) redirect("/admin");
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
        <h1 className="text-3xl font-semibold leading-tight">New post</h1>
      </div>
      <NewsEditor
        mode="create"
        games={games}
        locale={locale}
        currentUser={{ discordId: access.discordUserId, name: access.displayName }}
      />
    </main>
  );
}
