"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckIcon, EyeOffIcon, Loader2Icon, RotateCcwIcon, Trash2Icon, XIcon } from "lucide-react";
import { LocalDateTime } from "@/components/local-date-time";
import { AuthorAvatar } from "@/components/news/author-avatar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type ModComment = {
  id: number;
  postId: number;
  postTitle: string | null;
  parentCommentId: number | null;
  authorName: string;
  authorAvatarUrl: string | null;
  discordUserId: string;
  body: string;
  status: "visible" | "pending" | "hidden" | "rejected" | "deleted";
  flagReason: { profanity?: string[]; links?: string[] } | null;
  createdAt: string;
  editedAt: string | null;
  deletedBy: string | null;
};

const FILTERS = ["pending", "flagged", "visible", "hidden", "rejected", "deleted"] as const;
type Filter = (typeof FILTERS)[number];

// Actions offered per current status.
const ACTIONS: Record<string, Array<"approve" | "reject" | "hide" | "restore" | "delete">> = {
  pending: ["approve", "reject", "hide", "delete"],
  visible: ["hide", "delete"],
  hidden: ["restore", "reject", "delete"],
  rejected: ["restore", "delete"],
  deleted: ["restore"],
};

const ACTION_META: Record<string, { label: string; icon: typeof CheckIcon; variant?: "outline" | "destructive" | "ghost" }> = {
  approve: { label: "Approve", icon: CheckIcon },
  reject: { label: "Reject", icon: XIcon, variant: "outline" },
  hide: { label: "Hide", icon: EyeOffIcon, variant: "outline" },
  restore: { label: "Restore", icon: RotateCcwIcon, variant: "outline" },
  delete: { label: "Delete", icon: Trash2Icon, variant: "destructive" },
};
const ACTION_DONE: Record<string, string> = {
  approve: "Comment approved successfully.",
  reject: "Comment rejected successfully.",
  hide: "Comment hidden successfully.",
  restore: "Comment restored successfully.",
  delete: "Comment deleted successfully.",
};

export function CommentModeration() {
  const [filter, setFilter] = useState<Filter>("pending");
  const [comments, setComments] = useState<ModComment[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ModComment | null>(null);

  const load = useCallback(async (f: Filter) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/comments?status=${f}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
      setComments(json.comments);
      setCounts(json.counts || {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // load() only setStates inside async continuations (after fetch), not synchronously.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(filter);
  }, [filter, load]);

  async function moderate(id: number, action: string) {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/comments/${id}/moderate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
      await load(filter);
      setNotice(ACTION_DONE[action] || "Comment updated successfully.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Button key={f} variant={f === filter ? "default" : "outline"} size="sm" onClick={() => setFilter(f)} className="capitalize">
            {f}
            {counts[f] != null ? <span className="ms-1 tabular-nums opacity-70">{counts[f]}</span> : null}
          </Button>
        ))}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <AlertTitle>Done</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" /> Loading…
        </div>
      ) : comments.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No comments in “{filter}”.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((c) => (
            <li key={c.id} className="flex flex-col gap-2 rounded-lg border p-4">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <AuthorAvatar name={c.authorName} avatarUrl={c.authorAvatarUrl} className="size-7" />
                <span className="font-medium">{c.authorName || "—"}</span>
                <span className="text-xs text-muted-foreground">({c.discordUserId})</span>
                <span aria-hidden>·</span>
                <span className="text-xs text-muted-foreground">
                  <LocalDateTime value={c.createdAt} locale="en" />
                </span>
                <Badge variant="outline" className="capitalize">{c.status}</Badge>
                {c.parentCommentId ? <Badge variant="secondary">reply</Badge> : null}
              </div>

              <div className="text-xs text-muted-foreground">
                on{" "}
                <a href={`/admin/news/${c.postId}`} className="underline-offset-2 hover:underline">
                  {c.postTitle || `post #${c.postId}`}
                </a>
              </div>

              <p dir="auto" className="bidi-plaintext whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-sm">
                {c.body}
              </p>

              {c.flagReason ? (
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {c.flagReason.profanity?.length ? (
                    <Badge variant="destructive">profanity: {c.flagReason.profanity.join(", ")}</Badge>
                  ) : null}
                  {c.flagReason.links?.length ? (
                    <Badge variant="outline">links: {c.flagReason.links.join(", ")}</Badge>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-1.5 pt-1">
                {(ACTIONS[c.status] || ["delete"]).map((action) => {
                  const meta = ACTION_META[action];
                  return (
                    <Button
                      key={action}
                      size="sm"
                      variant={meta.variant ?? "default"}
                      disabled={busyId === c.id}
                      onClick={() => {
                        if (action === "delete") setDeleteTarget(c);
                        else void moderate(c.id, action);
                      }}
                    >
                      <meta.icon data-icon="inline-start" />
                      {meta.label}
                    </Button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete this comment?"
        description="This removes the comment from public threads while keeping the moderation history."
        cancelLabel="Cancel"
        actions={[
          {
            label: "Delete",
            variant: "destructive",
            onClick: () => {
              const target = deleteTarget;
              setDeleteTarget(null);
              if (target) void moderate(target.id, "delete");
            },
          },
        ]}
      />
    </div>
  );
}
