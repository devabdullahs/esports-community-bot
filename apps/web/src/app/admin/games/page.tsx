import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { GamesList } from "@/components/admin/games-list";
import { getAdminAccess } from "@/lib/admin";
import { listGames } from "@/lib/games";
import { Button } from "@/components/ui/button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminGamesPage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/games");
  if (!access.allowed) redirect("/admin");

  const allGames = await listGames();
  const games =
    access.games === "ALL" ? allGames : allGames.filter((g) => access.games.includes(g.slug));

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-5 py-10 sm:px-8">
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
        <h1 className="text-3xl font-semibold leading-tight">Game pages</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Add, edit, reorder, or remove the games shown on the public site. Deleting a
          game also removes its news posts.
        </p>
      </div>
      <GamesList games={games} canManageGames={access.isSuper} />
    </main>
  );
}
