"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { LocalDateTime } from "@/components/local-date-time";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { localizeText } from "@/lib/community-content";
import { getAdminCopy } from "@/lib/admin-copy";
import type { GameRecord } from "@/lib/games";
import { localizedPath, type Locale } from "@/lib/i18n";
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
  locale,
  newPostHref = "/admin/news/new",
}: {
  posts: NewsPost[];
  games: GameRecord[];
  locale: Locale;
  newPostHref?: string;
}) {
  const router = useRouter();
  const t = getAdminCopy(locale);
  // A post is owned by a game or a media channel; label whichever it is.
  const ownerLabel = (post: NewsPost): string => {
    if (!post.mediaSlug && !post.gameSlug) return t.common.empty;
    if (post.mediaSlug) return post.mediaSlug;
    if (post.gameSlug) {
      const game = games.find((g) => g.slug === post.gameSlug);
      return game ? localizeText(game.title, locale) : post.gameSlug;
    }
    return t.common.empty;
  };
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);

  async function remove(id: number) {
    setPendingDeleteId(null);
    setDeletingId(id);
    setDeleteError(null);
    setDeleteSuccess(null);
    try {
      const res = await fetch(`/api/admin/news/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setDeleteError(body?.error || t.common.deleteFailed(res.status));
        return;
      }
      setDeleteError(null);
      setDeleteSuccess(t.newsList.deleteSuccess);
      router.refresh();
    } catch {
      setDeleteError(t.common.networkError);
    } finally {
      setDeletingId(null);
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
      {deleteSuccess ? (
        <Alert>
          <AlertTitle>{t.common.done}</AlertTitle>
          <AlertDescription>{deleteSuccess}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {t.newsList.postsCount(posts.length)}
        </p>
        <Button
          render={<Link href={localizedPath(newPostHref, locale)} />}
          nativeButton={false}
          className="w-full sm:w-auto"
        >
          <PlusIcon data-icon="inline-start" />
          {t.newsList.newPost}
        </Button>
      </div>

      {posts.length ? (
        <>
          <div className="grid gap-3 md:hidden">
            {posts.map((post) => (
              <article
                key={post.id}
                className="min-w-0 rounded-xl border border-border/70 bg-card/70 p-3 shadow-sm"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="line-clamp-2 text-sm font-semibold leading-5">
                      {post.title}
                    </h3>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {post.mediaSlug ? (
                        <Badge variant="outline" className="font-normal">
                          {t.newsList.mediaBadge}
                        </Badge>
                      ) : null}
                      <span className="min-w-0 truncate">{ownerLabel(post)}</span>
                    </div>
                  </div>
                  <Badge
                    variant={post.status === "published" ? "default" : "secondary"}
                    className="shrink-0"
                  >
                    {post.status === "published" ? t.newsList.published : t.newsList.draft}
                  </Badge>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {post.contentMode === "translated"
                      ? t.newsList.translatedContent
                      : t.newsList.sharedContent(post.defaultLocale)}
                  </span>
                  <span>
                    <LocalDateTime value={post.updatedAt} locale={locale} />
                  </span>
                </div>

                <div className="mt-3 flex justify-end gap-1">
                  <Button
                    render={<Link href={localizedPath(`/admin/news/${post.id}`, locale)} />}
                    nativeButton={false}
                    variant="ghost"
                    size="icon-sm"
                    title={t.common.edit}
                    aria-label={t.common.edit}
                  >
                    <PencilIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={t.common.delete}
                    aria-label={t.common.delete}
                    className="text-destructive"
                    disabled={deletingId === post.id}
                    onClick={() => {
                      setDeleteError(null);
                      setDeleteSuccess(null);
                      setPendingDeleteId(post.id);
                    }}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </article>
            ))}
          </div>

          <div className="hidden overflow-x-auto rounded-md border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.newsList.headers.title}</TableHead>
                  <TableHead>{t.newsList.headers.owner}</TableHead>
                  <TableHead>{t.newsList.headers.content}</TableHead>
                  <TableHead>{t.newsList.headers.status}</TableHead>
                  <TableHead>{t.newsList.headers.updated}</TableHead>
                  <TableHead className="text-end">{t.newsList.headers.actions}</TableHead>
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
                            {t.newsList.mediaBadge}
                          </Badge>
                        ) : null}
                        {ownerLabel(post)}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {post.contentMode === "translated"
                        ? t.newsList.translatedContent
                        : t.newsList.sharedContent(post.defaultLocale)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={post.status === "published" ? "default" : "secondary"}>
                        {post.status === "published" ? t.newsList.published : t.newsList.draft}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <LocalDateTime value={post.updatedAt} locale={locale} />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          render={<Link href={localizedPath(`/admin/news/${post.id}`, locale)} />}
                          nativeButton={false}
                          variant="ghost"
                          size="icon-sm"
                          title={t.common.edit}
                          aria-label={t.common.edit}
                        >
                          <PencilIcon />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title={t.common.delete}
                          aria-label={t.common.delete}
                          className="text-destructive"
                          disabled={deletingId === post.id}
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteSuccess(null);
                            setPendingDeleteId(post.id);
                          }}
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
        </>
      ) : (
        <div className="rounded-md border border-dashed p-5 text-center sm:p-8">
          <p className="text-sm text-muted-foreground">
            {t.newsList.empty}
          </p>
        </div>
      )}
      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
        title={t.newsList.deleteTitle}
        description={t.newsList.deleteDescription}
        cancelLabel={t.common.cancel}
        actions={[
          {
            label: t.newsList.deleteAction,
            variant: "destructive",
            onClick: () => {
              if (pendingDeleteId !== null) void remove(pendingDeleteId);
            },
          },
        ]}
      />
    </div>
  );
}
