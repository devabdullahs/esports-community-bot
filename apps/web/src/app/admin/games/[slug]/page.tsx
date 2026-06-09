import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { GameEditor } from "@/components/admin/game-editor";
import { canManageGame, getAdminAccess } from "@/lib/admin";
import { getGame } from "@/lib/games";
import { Button } from "@/components/ui/button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function EditGamePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const access = await getAdminAccess();
  if (!access.session) redirect(`/login?callbackURL=/admin/games/${slug}`);
  if (!access.allowed) redirect("/admin");
  if (!canManageGame(access, slug)) redirect("/admin/games");

  const game = getGame(slug);
  if (!game) notFound();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-5 py-10 sm:px-8">
      <Button
        render={<Link href="/admin/games" />}
        nativeButton={false}
        variant="ghost"
        className="w-fit"
      >
        <ArrowLeftIcon data-icon="inline-start" />
        Back to games
      </Button>
      <div>
        <p className="text-sm text-muted-foreground">Admin publishing</p>
        <h1 className="text-3xl font-semibold leading-tight">Edit game</h1>
      </div>
      <GameEditor mode="edit" game={game} />
    </main>
  );
}
