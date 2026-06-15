"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { LocalDateTime } from "@/components/local-date-time";
import { localizeText } from "@/lib/community-content";
import type { GameRecord } from "@/lib/games";
import type { NewsPost } from "@/lib/news";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

export function NewsList({
  posts,
  games,
  newPostHref = "/admin/news/new",
}: {
  posts: NewsPost[];
  games: GameRecord[];
  newPostHref?: string;
}) {
  const router = useRouter();
  // A post is owned by a game or a media channel; label whichever it is.
  const ownerLabel = (post: NewsPost): string => {
    if (post.mediaSlug) return post.mediaSlug;
    if (post.gameSlug) {
      const game = games.find((g) => g.slug === post.gameSlug);
      return game ? localizeText(game.title, "en") : post.gameSlug;
    }
    return "—";
  };
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function remove(id: number) {
    if (!window.confirm("Delete this post? This cannot be undone.")) return;
    setDeletingId(id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/news/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setDeleteError(body?.error || `Delete failed (${res.status})`);
        return;
      }
      setDeleteError(null);
      router.refresh();
    } catch {
      setDeleteError("Network error — try again.");
    } finally {
      setDeletingId(null);
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
          {posts.length} post{posts.length === 1 ? "" : "s"}
        </p>
        <Button render={<Link href={newPostHref} />} nativeButton={false}>
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
                <TableHead>Owner</TableHead>
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
                  <TableCell className="text-muted-foreground">
                    <span className="flex items-center gap-2">
                      {post.mediaSlug ? (
                        <Badge variant="outline" className="font-normal">
                          Media
                        </Badge>
                      ) : null}
                      {ownerLabel(post)}
                    </span>
                  </TableCell>
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
                    <LocalDateTime value={post.updatedAt} locale="en" />
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
