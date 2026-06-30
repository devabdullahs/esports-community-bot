"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  HeartIcon,
  Loader2Icon,
  MessageCircleIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { DiscordIcon } from "@/components/discord-icon";
import { DateTime } from "@/components/date-time";
import { AuthorAvatar } from "@/components/news/author-avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Textarea } from "@/components/ui/textarea";
import { DISCORD_INVITE_URL } from "@/lib/community-links";
import { commentsCopy } from "@/lib/comments-i18n";
import { COMMENT_MAX_LENGTH } from "@/lib/comment-validation";
import { localizedPath, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type ApiComment = {
  id: number;
  authorName: string;
  authorAvatarUrl: string | null;
  body: string;
  status: "visible" | "pending" | "deleted";
  createdAt: string;
  editedAt: string | null;
  likeCount: number;
  viewerLiked: boolean;
  isOwn: boolean;
  isDeleted: boolean;
  replies: ApiComment[];
};

type ApiData = {
  comments: ApiComment[];
  postLike: { count: number; liked: boolean };
  viewer: {
    signedIn: boolean;
    verified: boolean;
    inGuild: boolean;
    discordUserId: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
};

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

export function CommentsSection({ postId, locale }: { postId: number; locale: Locale }) {
  const t = commentsCopy[locale];
  const pathname = usePathname();
  const [data, setData] = useState<ApiData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api(`/api/news/${postId}/comments`, "GET"));
      setError(null);
    } catch {
      setError(t.loadError);
    }
  }, [postId, t.loadError]);

  // load() only setStates inside async continuations (after fetch), not synchronously.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Silent background refresh (no spinner, no error alert) for near-live updates:
  // reuses the same bounded, per-IP-rate-limited public GET, so other users'
  // likes/new comments appear without a manual reload. Composer/edit/reply state
  // is component-local and survives the re-render (React reconciles by comment id).
  const refresh = useCallback(async () => {
    try {
      setData(await api(`/api/news/${postId}/comments`, "GET"));
    } catch {
      // Ignore transient background-refresh failures; the next tick retries.
    }
  }, [postId]);

  useEffect(() => {
    const POLL_MS = 15_000;
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(tick, POLL_MS);
    // Catch up immediately when the tab regains focus.
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  const verified = data?.viewer.verified ?? false;

  async function run(fn: () => Promise<void>) {
    setActionError(null);
    setActionNotice(null);
    try {
      await fn();
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  async function togglePostLike() {
    if (!data) return;
    await run(async () => {
      const liked = data.postLike.liked;
      const summary = await api(`/api/news/${postId}/like`, liked ? "DELETE" : "PUT");
      setData((d) => (d ? { ...d, postLike: summary } : d));
    });
  }

  // Walk the tree and patch one comment's like state in place (cheap, no refetch).
  function patchLike(id: number, summary: { count: number; liked: boolean }) {
    setData((d) => {
      if (!d) return d;
      const patch = (list: ApiComment[]): ApiComment[] =>
        list.map((c) => ({
          ...c,
          ...(c.id === id ? { likeCount: summary.count, viewerLiked: summary.liked } : {}),
          replies: patch(c.replies),
        }));
      return { ...d, comments: patch(d.comments) };
    });
  }

  async function toggleCommentLike(c: ApiComment) {
    await run(async () => {
      const summary = await api(`/api/comments/${c.id}/like`, c.viewerLiked ? "DELETE" : "PUT");
      patchLike(c.id, summary);
    });
  }

  async function submit(body: string, parentCommentId: number | null) {
    await run(async () => {
      await api(`/api/news/${postId}/comments`, "POST", { body, parentCommentId });
      await load();
    });
  }
  async function saveEdit(id: number, body: string) {
    await run(async () => {
      await api(`/api/comments/${id}`, "PATCH", { body });
      await load();
    });
  }
  async function remove(id: number) {
    setDeleteTargetId(null);
    await run(async () => {
      await api(`/api/comments/${id}`, "DELETE");
      await load();
      setActionNotice(t.removeSuccess);
    });
  }

  // Total real comments across the whole tree (roots + replies), excluding the
  // "[removed]" placeholders shown to keep deleted threads from collapsing.
  const countComments = (list: ApiComment[]): number =>
    list.reduce((n, c) => n + (c.isDeleted ? 0 : 1) + countComments(c.replies), 0);
  const total = data ? countComments(data.comments) : 0;

  return (
    <>
    <section className="flex flex-col gap-5 border-t pt-8" dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <MessageCircleIcon className="size-5" />
          {t.title}
          {total ? <span className="text-base font-normal text-muted-foreground">· {total}</span> : null}
        </h2>
        {data ? (
          <Button
            variant={data.postLike.liked ? "default" : "outline"}
            size="sm"
            onClick={togglePostLike}
            disabled={!verified}
            aria-pressed={data.postLike.liked}
            title={!verified ? t.verifyToComment : undefined}
          >
            <HeartIcon data-icon="inline-start" className={cn(data.postLike.liked && "fill-current")} />
            {data.postLike.liked ? t.postLiked : t.postLike}
            <span className="tabular-nums">· {data.postLike.count}</span>
          </Button>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {actionError ? (
        <Alert variant="destructive">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}
      {actionNotice ? (
        <Alert>
          <AlertDescription>{actionNotice}</AlertDescription>
        </Alert>
      ) : null}

      {/* Composer or CTA */}
      {data ? (
        data.viewer.verified ? (
          <Composer locale={locale} onSubmit={(body) => submit(body, null)} />
        ) : !data.viewer.signedIn ? (
          <CtaCard
            text={t.signInToComment}
            action={
              <Button render={<Link href={localizedPath(`/login?callbackURL=${encodeURIComponent(pathname)}`, locale)} />} nativeButton={false} size="sm">
                {t.signIn}
              </Button>
            }
          />
        ) : (
          <CtaCard
            text={data.viewer.inGuild ? t.verifyToComment : t.joinToComment}
            action={
              <Button render={<a href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer" />} nativeButton={false} variant="outline" size="sm">
                <DiscordIcon data-icon="inline-start" />
                {t.joinDiscord}
              </Button>
            }
          />
        )
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
        </div>
      )}

      {/* Thread list */}
      {data && data.comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.empty}</p>
      ) : null}
      <ul className="flex flex-col gap-5">
        {data?.comments.map((c) => (
          <li key={c.id}>
            <CommentNode
              comment={c}
              locale={locale}
              canReply={verified}
              onLike={toggleCommentLike}
              onReply={(body) => submit(body, c.id)}
              onEdit={saveEdit}
              onDelete={setDeleteTargetId}
            />
          </li>
        ))}
      </ul>
    </section>
    <ConfirmDialog
      open={deleteTargetId !== null}
      onOpenChange={(open) => {
        if (!open) setDeleteTargetId(null);
      }}
      title={t.removeConfirm}
      description={t.removeDialogDescription}
      cancelLabel={t.cancel}
      actions={[
        {
          label: t.remove,
          variant: "destructive",
          onClick: () => {
            if (deleteTargetId !== null) void remove(deleteTargetId);
          },
        },
      ]}
    />
    </>
  );
}

function CtaCard({ text, action }: { text: string; action: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-3">
      <p className="text-sm text-muted-foreground">{text}</p>
      {action}
    </div>
  );
}

function Composer({
  locale,
  onSubmit,
  initial = "",
  placeholderKey = "composerPlaceholder",
  submitKey = "send",
  autoFocus = false,
  onCancel,
}: {
  locale: Locale;
  onSubmit: (body: string) => Promise<void>;
  initial?: string;
  placeholderKey?: "composerPlaceholder" | "replyPlaceholder";
  submitKey?: "send" | "save";
  autoFocus?: boolean;
  onCancel?: () => void;
}) {
  const t = commentsCopy[locale];
  const [body, setBody] = useState(initial);
  const [busy, setBusy] = useState(false);
  const trimmed = body.trim();
  const overLimit = body.length > COMMENT_MAX_LENGTH;
  const canSend = trimmed.length > 0 && !overLimit && !busy;

  async function send() {
    if (!canSend) return;
    setBusy(true);
    try {
      await onSubmit(trimmed);
      setBody("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={body}
        dir="auto"
        autoFocus={autoFocus}
        rows={3}
        maxLength={COMMENT_MAX_LENGTH + 200}
        placeholder={t[placeholderKey]}
        onChange={(e) => setBody(e.target.value)}
        className="bidi-plaintext resize-y"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cn("text-xs text-muted-foreground", overLimit && "text-destructive")}>
          {body.length}/{COMMENT_MAX_LENGTH}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {onCancel ? (
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
              {t.cancel}
            </Button>
          ) : null}
          <Button size="sm" onClick={send} disabled={!canSend}>
            {busy ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : null}
            {busy ? t.sending : t[submitKey]}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CommentNode({
  comment,
  locale,
  canReply,
  onLike,
  onReply,
  onEdit,
  onDelete,
  isReply = false,
}: {
  comment: ApiComment;
  locale: Locale;
  canReply: boolean;
  onLike: (c: ApiComment) => void;
  onReply: (body: string) => Promise<void>;
  onEdit: (id: number, body: string) => Promise<void>;
  onDelete: (id: number) => void;
  isReply?: boolean;
}) {
  const t = commentsCopy[locale];
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);

  if (comment.isDeleted) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm italic text-muted-foreground">{t.removed}</p>
        {comment.replies.length ? (
          <ul className="flex flex-col gap-4 ps-5 border-s">
            {comment.replies.map((r) => (
              <li key={r.id}>
                <CommentNode comment={r} locale={locale} canReply={false} onLike={onLike} onReply={onReply} onEdit={onEdit} onDelete={onDelete} isReply />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <AuthorAvatar name={comment.authorName} avatarUrl={comment.authorAvatarUrl} className="mt-0.5 size-8 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
            <span className="font-semibold">{comment.authorName || "—"}</span>
            <span className="text-xs text-muted-foreground">
              <DateTime value={comment.createdAt} locale={locale} />
            </span>
            {comment.editedAt ? <span className="text-xs text-muted-foreground">({t.edited})</span> : null}
            {comment.status === "pending" ? (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                {t.pending}
              </span>
            ) : null}
          </div>

          {editing ? (
            <Composer
              locale={locale}
              initial={comment.body}
              submitKey="save"
              autoFocus
              onCancel={() => setEditing(false)}
              onSubmit={async (body) => {
                await onEdit(comment.id, body);
                setEditing(false);
              }}
            />
          ) : (
            <p dir="auto" className="bidi-plaintext whitespace-pre-wrap break-words text-sm leading-6">
              {comment.body}
            </p>
          )}

          {comment.status === "pending" ? (
            <p className="text-xs text-muted-foreground">{t.pendingHint}</p>
          ) : null}

          {!editing ? (
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <button
                type="button"
                onClick={() => onLike(comment)}
                className={cn("inline-flex items-center gap-1 transition-colors hover:text-foreground", comment.viewerLiked && "text-rose-500 hover:text-rose-500")}
                aria-pressed={comment.viewerLiked}
              >
                <HeartIcon className={cn("size-3.5", comment.viewerLiked && "fill-current")} />
                {comment.likeCount > 0 ? <span className="tabular-nums">{comment.likeCount}</span> : null}
                <span className="sr-only">{t.like}</span>
              </button>
              {!isReply && canReply ? (
                <button type="button" onClick={() => setReplying((v) => !v)} className="inline-flex items-center gap-1 transition-colors hover:text-foreground">
                  <MessageCircleIcon className="size-3.5" />
                  {t.reply}
                </button>
              ) : null}
              {comment.isOwn ? (
                <>
                  <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 transition-colors hover:text-foreground">
                    <PencilIcon className="size-3.5" />
                    {t.edit}
                  </button>
                  <button type="button" onClick={() => onDelete(comment.id)} className="inline-flex items-center gap-1 transition-colors hover:text-destructive">
                    <Trash2Icon className="size-3.5" />
                    {t.remove}
                  </button>
                </>
              ) : null}
            </div>
          ) : null}

          {replying ? (
            <div className="mt-1">
              <Composer
                locale={locale}
                placeholderKey="replyPlaceholder"
                autoFocus
                onCancel={() => setReplying(false)}
                onSubmit={async (body) => {
                  await onReply(body);
                  setReplying(false);
                }}
              />
            </div>
          ) : null}
        </div>
      </div>

      {comment.replies.length ? (
        <ul className="flex flex-col gap-4 ps-11">
          {comment.replies.map((r) => (
            <li key={r.id}>
              <CommentNode comment={r} locale={locale} canReply={false} onLike={onLike} onReply={onReply} onEdit={onEdit} onDelete={onDelete} isReply />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
