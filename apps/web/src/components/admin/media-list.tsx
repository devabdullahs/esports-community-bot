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
import { localizedPath, type Locale } from "@/lib/i18n";
import type { MediaChannelRecord } from "@/lib/media";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function MediaList({
  channels,
  isSuper,
  editableSlugs,
  locale,
}: {
  channels: MediaChannelRecord[];
  isSuper: boolean;
  editableSlugs: string[];
  locale: Locale;
}) {
  const router = useRouter();
  const t = getAdminCopy(locale);
  const [items, setItems] = useState<MediaChannelRecord[]>(channels);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ slug: string; name: string } | null>(null);
  const canEdit = (slug: string) => isSuper || editableSlugs.includes(slug);

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const previous = items;
    const next = items.slice();
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/media/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slugs: next.map((c) => c.slug) }),
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
      const res = await fetch(`/api/admin/media/${slug}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setDeleteError(body?.error || t.common.deleteFailed(res.status));
        return;
      }
      setDeleteError(null);
      setItems((prev) => prev.filter((c) => c.slug !== slug));
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
          {t.media.count(items.length)}
        </p>
        {isSuper ? (
          <Button
            render={<Link href={localizedPath("/admin/media/new", locale)} />}
            nativeButton={false}
            className="w-full sm:w-auto"
          >
            <PlusIcon data-icon="inline-start" />
            {t.media.newAction}
          </Button>
        ) : null}
      </div>

      {items.length ? (
        <div className="flex flex-col gap-2">
          {items.map((channel, index) => (
            <div key={channel.slug} className="flex items-start gap-3 rounded-lg border p-3 sm:items-center">
              {isSuper ? (
                <div className="flex flex-col">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                    title={t.media.moveUp}
                    aria-label={t.media.moveUp}
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={busy || index === items.length - 1}
                    onClick={() => move(index, 1)}
                    title={t.media.moveDown}
                    aria-label={t.media.moveDown}
                  >
                    <ArrowDownIcon />
                  </Button>
                </div>
              ) : null}
              <div className="flex flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{localizeText(channel.name, locale)}</span>
                  <Badge variant="secondary">
                    {t.media.linkCount(channel.links.length)}
                  </Badge>
                </div>
                <span className="font-mono text-xs text-muted-foreground">/media/{channel.slug}</span>
              </div>
              <div className="flex shrink-0 gap-1">
                {canEdit(channel.slug) ? (
                  <Button
                    render={<Link href={localizedPath(`/admin/media/${channel.slug}`, locale)} />}
                    nativeButton={false}
                    variant="ghost"
                    size="icon-sm"
                    title={t.common.edit}
                    aria-label={t.common.edit}
                  >
                    <PencilIcon />
                  </Button>
                ) : null}
                {isSuper ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive"
                    disabled={busy}
                    onClick={() => setDeleteTarget({ slug: channel.slug, name: localizeText(channel.name, locale) })}
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
          <p className="text-sm text-muted-foreground">{t.media.empty}</p>
        </div>
      )}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={deleteTarget ? t.media.deleteConfirm(deleteTarget.name) : t.common.delete}
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
