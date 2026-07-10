"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BanIcon, CheckIcon, EyeOffIcon, Loader2Icon, Trash2Icon, UndoIcon } from "lucide-react";
import { LocalDateTime } from "@/components/local-date-time";
import { getAdminCopy } from "@/lib/admin-copy";
import { localizedPath, type Locale } from "@/lib/i18n";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";

type UserComment = {
  id: number;
  postId: number;
  body: string;
  status: string;
  createdAt: string;
};

type ModerationAction = "approve" | "hide" | "delete";

// Actions offered per comment status, mirroring the comments admin view but
// scoped to what makes sense from a member's history.
const ACTIONS: Record<string, ModerationAction[]> = {
  pending: ["approve", "hide", "delete"],
  visible: ["hide", "delete"],
  hidden: ["approve", "delete"],
  rejected: ["approve", "delete"],
  deleted: ["approve"],
};

export function UserModeration({
  discordId,
  blocked,
  comments,
  locale,
}: {
  discordId: string;
  blocked: boolean;
  comments: UserComment[];
  locale: Locale;
}) {
  const t = getAdminCopy(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [busyCommentId, setBusyCommentId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserComment | null>(null);

  async function setBlocked(next: boolean) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/users/${discordId}/block`, {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: next ? JSON.stringify({ reason: reason || undefined }) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
      setNotice(next ? t.users.block.blockedNotice : t.users.block.unblockedNotice);
      setReason("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function moderate(id: number, action: ModerationAction) {
    setBusyCommentId(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/comments/${id}/moderate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
      setNotice(t.users.moderation.done);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyCommentId(null);
    }
  }

  const actionMeta: Record<ModerationAction, { icon: typeof CheckIcon; variant?: "outline" | "destructive"; label: string }> = {
    approve: { icon: CheckIcon, label: t.users.moderation.approve },
    hide: { icon: EyeOffIcon, variant: "outline", label: t.users.moderation.hide },
    delete: { icon: Trash2Icon, variant: "destructive", label: t.users.moderation.delete },
  };

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.common.actionFailed}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <AlertTitle>{t.common.done}</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {blocked ? (
          <Button variant="outline" disabled={busy} onClick={() => void setBlocked(false)}>
            {busy ? <Loader2Icon className="size-4 animate-spin" data-icon="inline-start" /> : <UndoIcon data-icon="inline-start" />}
            {t.users.block.unblockAction}
          </Button>
        ) : (
          <>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t.users.block.reasonPlaceholder}
              className="sm:max-w-xs"
            />
            <Button variant="destructive" disabled={busy} onClick={() => setConfirmBlock(true)}>
              {busy ? <Loader2Icon className="size-4 animate-spin" data-icon="inline-start" /> : <BanIcon data-icon="inline-start" />}
              {t.users.block.blockAction}
            </Button>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t.users.detail.commentsTitle}</h2>
        {comments.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t.users.detail.noComments}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {comments.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 rounded-lg border p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{t.comments.filters[c.status as keyof typeof t.comments.filters] ?? c.status}</Badge>
                  <LocalDateTime value={c.createdAt} locale={locale} />
                  <a
                    href={localizedPath(`/admin/news/${c.postId}`, locale)}
                    className="underline-offset-2 hover:underline"
                  >
                    {t.comments.postFallback(c.postId)}
                  </a>
                </div>
                <p dir="auto" className="bidi-plaintext whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-sm">
                  {c.body}
                </p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {(ACTIONS[c.status] ?? ["delete"]).map((action) => {
                    const meta = actionMeta[action];
                    return (
                      <Button
                        key={action}
                        size="sm"
                        variant={meta.variant ?? "default"}
                        disabled={busyCommentId === c.id}
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
      </div>

      <ConfirmDialog
        open={confirmBlock}
        onOpenChange={(open) => {
          if (!open) setConfirmBlock(false);
        }}
        title={t.users.block.confirmTitle}
        description={t.users.block.confirmDescription}
        cancelLabel={t.common.cancel}
        actions={[
          {
            label: t.users.block.confirmAction,
            variant: "destructive",
            onClick: () => {
              setConfirmBlock(false);
              void setBlocked(true);
            },
          },
        ]}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t.users.moderation.deleteTitle}
        description={t.users.moderation.deleteDescription}
        cancelLabel={t.common.cancel}
        actions={[
          {
            label: t.common.delete,
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
