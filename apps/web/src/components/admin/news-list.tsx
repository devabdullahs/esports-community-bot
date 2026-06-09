"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { localizeText } from "@/lib/community-content";
import type { GameRecord } from "@/lib/games";
import { formatDateTime } from "@/lib/i18n";
import type { NewsPost } from "@/lib/news";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function NewsList({ posts, games }: { posts: NewsPost[]; games: GameRecord[] }) {
  const router = useRouter();
  const gameTitle = (slug: string) => {
    const game = games.find((g) => g.slug === slug);
    return game ? localizeText(game.title, "en") : slug;
  };
  const [deletingId, setDeletingId] = useState<number | null>(null);

  async function remove(id: number) {
    if (!window.confirm("Delete this post? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      await fetch(`/api/admin/news/${id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {posts.length} post{posts.length === 1 ? "" : "s"}
        </p>
        <Button render={<Link href="/admin/news/new" />} nativeButton={false}>
          <PlusIcon data-icon="inline-start" />
          New post
        </Button>
      </div>

      {posts.length ? (
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Game</TableHead>
                <TableHead>Content</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {posts.map((post) => (
                <TableRow key={post.id}>
                  <TableCell className="font-medium">{post.title}</TableCell>
                  <TableCell className="text-muted-foreground">{gameTitle(post.gameSlug)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {post.contentMode === "translated"
                      ? "English + Arabic"
                      : `Shared ${post.defaultLocale.toUpperCase()}`}
                  </TableCell>
                  <TableCell>
                    <Badge variant={post.status === "published" ? "default" : "secondary"}>
                      {post.status === "published" ? "Published" : "Draft"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(post.updatedAt, "en")}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        render={<Link href={`/admin/news/${post.id}`} />}
                        nativeButton={false}
                        variant="ghost"
                        size="icon-sm"
                        title="Edit"
                        aria-label="Edit"
                      >
                        <PencilIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Delete"
                        aria-label="Delete"
                        className="text-destructive"
                        disabled={deletingId === post.id}
                        onClick={() => remove(post.id)}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="rounded-md border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No posts yet. Create your first community update.
          </p>
        </div>
      )}
    </div>
  );
}
