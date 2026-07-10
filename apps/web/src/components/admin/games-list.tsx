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
import { getAdminCopy } from "@/lib/admin-copy";
import type { GameRecord } from "@/lib/games";
import { localizedPath, type Locale } from "@/lib/i18n";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function GamesList({
  games,
  locale,
  canManageGames = true,
}: {
  games: GameRecord[];
  locale: Locale;
  canManageGames?: boolean;
}) {
  const router = useRouter();
  const t = getAdminCopy(locale);
  const [items, setItems] = useState<GameRecord[]>(games);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ slug: string; title: string } | null>(null);

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

  async function remove(slug: string) {
    setDeleteError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/games/${slug}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setDeleteError(body?.error || t.common.deleteFailed(res.status));
        return;
      }
      setDeleteError(null);
      setItems((prev) => prev.filter((g) => g.slug !== slug));
      router.refresh();
    } catch {
      setDeleteError(t.common.networkError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {deleteError ? (
        <Alert variant="destructive">
          <AlertTitle>{t.common.couldNotDelete}</AlertTitle>
          <AlertDescription>{deleteError}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {t.games.count(items.length)}
        </p>
        {canManageGames ? (
          <Button
            render={<Link href={localizedPath("/admin/games/new", locale)} />}
            nativeButton={false}
            className="w-full sm:w-auto"
          >
            <PlusIcon data-icon="inline-start" />
            {t.games.newAction}
          </Button>
        ) : null}
      </div>

      {items.length ? (
        <div className="flex flex-col gap-2">
          {items.map((game, index) => (
            <div key={game.slug} className="flex items-start gap-3 rounded-lg border p-3 sm:items-center">
              {canManageGames ? (
                <div className="flex flex-col">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                    title={t.games.moveUp}
                    aria-label={t.games.moveUp}
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={busy || index === items.length - 1}
                    onClick={() => move(index, 1)}
                    title={t.games.moveDown}
                    aria-label={t.games.moveDown}
                  >
                    <ArrowDownIcon />
                  </Button>
                </div>
              ) : null}
              <div className="flex flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{localizeText(game.title, locale)}</span>
                  {localizeText(game.status, locale) ? (
                    <Badge variant="secondary">{localizeText(game.status, locale)}</Badge>
                  ) : null}
                </div>
                <span className="font-mono text-xs text-muted-foreground">/games/{game.slug}</span>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  render={<Link href={localizedPath(`/admin/games/${game.slug}`, locale)} />}
                  nativeButton={false}
                  variant="ghost"
                  size="icon-sm"
                  title={t.common.edit}
                  aria-label={t.common.edit}
                >
                  <PencilIcon />
                </Button>
                {canManageGames ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive"
                    disabled={busy}
                  onClick={() => setDeleteTarget({ slug: game.slug, title: localizeText(game.title, locale) })}
                  title={t.common.delete}
                  aria-label={t.common.delete}
                >
                    <Trash2Icon />
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed p-5 text-center sm:p-8">
          <p className="text-sm text-muted-foreground">{t.games.empty}</p>
        </div>
      )}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={deleteTarget ? t.games.deleteConfirm(deleteTarget.title) : t.common.delete}
        cancelLabel={t.common.cancel}
        actions={[
          {
            label: t.common.delete,
            variant: "destructive",
            onClick: () => {
              const target = deleteTarget;
              setDeleteTarget(null);
        if (target) void remove(target.slug);
      },
    },
  ]}
/>
    </div>
  );
}
