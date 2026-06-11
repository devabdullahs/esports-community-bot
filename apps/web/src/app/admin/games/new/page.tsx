import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { GameEditor } from "@/components/admin/game-editor";
import { getAdminAccess } from "@/lib/admin";
import { getRequestLocale } from "@/lib/request-locale";
import { Button } from "@/components/ui/button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NewGamePage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/games/new");
  if (!access.isSuper) redirect("/admin/games");
  const locale = await getRequestLocale();

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
        <h1 className="text-3xl font-semibold leading-tight">New game</h1>
      </div>
      <GameEditor mode="create" locale={locale} />
    </main>
  );
}
