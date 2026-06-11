"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { localizeText } from "@/lib/community-content";
import type { GameRecord } from "@/lib/games";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function GamesList({
  games,
  canManageGames = true,
}: {
  games: GameRecord[];
  canManageGames?: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState<GameRecord[]>(games);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const previous = items;
    const next = items.slice();
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/games/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slugs: next.map((g) => g.slug) }),
      });
      if (!res.ok) setItems(previous);
      else router.refresh();
    } catch {
      setItems(previous);
    } finally {
      setBusy(false);
    }
  }

  async function remove(slug: string, title: string) {
    if (
      !window.confirm(
        `Delete "${title}"? This also deletes its news posts and cannot be undone.`,
      )
    )
      return;
    setDeleteError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/games/${slug}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setDeleteError(body?.error || `Delete failed (${res.status})`);
        return;
      }
      setDeleteError(null);
      setItems((prev) => prev.filter((g) => g.slug !== slug));
      router.refresh();
    } catch {
      setDeleteError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {deleteError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not delete</AlertTitle>
          <AlertDescription>{deleteError}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {items.length} game{items.length === 1 ? "" : "s"}
        </p>
        {canManageGames ? (
          <Button render={<Link href="/admin/games/new" />} nativeButton={false}>
            <PlusIcon data-icon="inline-start" />
            New game
          </Button>
        ) : null}
      </div>

      {items.length ? (
        <div className="flex flex-col gap-2">
          {items.map((game, index) => (
            <div key={game.slug} className="flex items-center gap-3 rounded-lg border p-3">
              {canManageGames ? (
                <div className="flex flex-col">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                    title="Move up"
                    aria-label="Move up"
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={busy || index === items.length - 1}
                    onClick={() => move(index, 1)}
                    title="Move down"
                    aria-label="Move down"
                  >
                    <ArrowDownIcon />
                  </Button>
                </div>
              ) : null}
              <div className="flex flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{localizeText(game.title, "en")}</span>
                  {localizeText(game.status, "en") ? (
                    <Badge variant="secondary">{localizeText(game.status, "en")}</Badge>
                  ) : null}
                </div>
                <span className="font-mono text-xs text-muted-foreground">/games/{game.slug}</span>
              </div>
              <div className="flex gap-1">
                <Button
                  render={<Link href={`/admin/games/${game.slug}`} />}
                  nativeButton={false}
                  variant="ghost"
                  size="icon-sm"
                  title="Edit"
                  aria-label="Edit"
                >
                  <PencilIcon />
                </Button>
                {canManageGames ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive"
                    disabled={busy}
                    onClick={() => remove(game.slug, localizeText(game.title, "en"))}
                    title="Delete"
                    aria-label="Delete"
                  >
                    <Trash2Icon />
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">No games yet. Add your first game.</p>
        </div>
      )}
    </div>
  );
}
