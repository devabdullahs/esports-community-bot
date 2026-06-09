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
import type { MediaChannelRecord } from "@/lib/media";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function MediaList({
  channels,
  isSuper,
  editableSlugs,
}: {
  channels: MediaChannelRecord[];
  isSuper: boolean;
  editableSlugs: string[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<MediaChannelRecord[]>(channels);
  const [busy, setBusy] = useState(false);
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

  async function remove(slug: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/media/${slug}`, { method: "DELETE" });
      if (res.ok) {
        setItems((prev) => prev.filter((c) => c.slug !== slug));
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {items.length} channel{items.length === 1 ? "" : "s"}
        </p>
        {isSuper ? (
          <Button render={<Link href="/admin/media/new" />} nativeButton={false}>
            <PlusIcon data-icon="inline-start" />
            New channel
          </Button>
        ) : null}
      </div>

      {items.length ? (
        <div className="flex flex-col gap-2">
          {items.map((channel, index) => (
            <div key={channel.slug} className="flex items-center gap-3 rounded-lg border p-3">
              {isSuper ? (
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
                  <span className="font-medium">{localizeText(channel.name, "en")}</span>
                  <Badge variant="secondary">
                    {channel.links.length} link{channel.links.length === 1 ? "" : "s"}
                  </Badge>
                </div>
                <span className="font-mono text-xs text-muted-foreground">/media/{channel.slug}</span>
              </div>
              <div className="flex gap-1">
                {canEdit(channel.slug) ? (
                  <Button
                    render={<Link href={`/admin/media/${channel.slug}`} />}
                    nativeButton={false}
                    variant="ghost"
                    size="icon-sm"
                    title="Edit"
                    aria-label="Edit"
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
                    onClick={() => remove(channel.slug, localizeText(channel.name, "en"))}
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
          <p className="text-sm text-muted-foreground">No media channels yet.</p>
        </div>
      )}
    </div>
  );
}
