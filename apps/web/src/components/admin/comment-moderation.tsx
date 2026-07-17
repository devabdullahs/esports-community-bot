"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckIcon,
  EyeOffIcon,
  FlagIcon,
  Loader2Icon,
  PauseCircleIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  SaveIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { LocalDateTime } from "@/components/local-date-time";
import { AuthorAvatar } from "@/components/news/author-avatar";
import { getAdminCopy } from "@/lib/admin-copy";
import { localizedPath, type Locale } from "@/lib/i18n";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type KeywordRule = {
  id: number;
  phrase: string;
  locale: "all" | "en" | "ar";
  scope: "global" | "news" | "match";
  action: "hold" | "flag";
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type KeywordRuleMatch = Pick<KeywordRule, "id" | "phrase" | "locale" | "scope" | "action">;

type ModComment = {
  id: number;
  targetType: "news" | "match";
  targetId: number;
  targetTitle: string | null;
  parentCommentId: number | null;
  authorName: string;
  authorAvatarUrl: string | null;
  discordUserId: string;
  body: string;
  status: "visible" | "pending" | "hidden" | "rejected" | "deleted";
  flagReason: {
    profanity?: string[];
    links?: string[];
    reviewTerms?: string[];
    keywordRules?: KeywordRuleMatch[];
  } | null;
  reportCount: number;
  createdAt: string;
  editedAt: string | null;
  deletedBy: string | null;
};

type RuleDraft = Pick<KeywordRule, "phrase" | "locale" | "scope" | "action">;

const EMPTY_RULE: RuleDraft = { phrase: "", locale: "all", scope: "global", action: "hold" };
const LOCALE_OPTIONS: Array<{ value: RuleDraft["locale"]; label: string }> = [
  { value: "all", label: "All locales" },
  { value: "en", label: "English" },
  { value: "ar", label: "Arabic" },
];
const SCOPE_OPTIONS: Array<{ value: RuleDraft["scope"]; label: string }> = [
  { value: "global", label: "Global" },
  { value: "news", label: "News" },
  { value: "match", label: "Matches" },
];
const RULE_ACTION_OPTIONS: Array<{ value: RuleDraft["action"]; label: string }> = [
  { value: "hold", label: "Hold" },
  { value: "flag", label: "Flag" },
];
const FILTERS = ["pending", "reported", "flagged", "visible", "hidden", "rejected", "deleted"] as const;
type Filter = (typeof FILTERS)[number];
type ModerationAction = "approve" | "reject" | "hold" | "hide" | "restore" | "delete";
type BulkAction = "approve" | "reject" | "hold";

const ACTIONS: Record<string, ModerationAction[]> = {
  pending: ["approve", "reject", "hide", "delete"],
  visible: ["hold", "hide", "delete"],
  hidden: ["restore", "reject", "delete"],
  rejected: ["restore", "delete"],
  deleted: ["restore"],
};

const ACTION_META: Record<ModerationAction, { icon: typeof CheckIcon; variant?: "outline" | "destructive" | "ghost" }> = {
  approve: { icon: CheckIcon },
  reject: { icon: XIcon, variant: "outline" },
  hold: { icon: PauseCircleIcon, variant: "outline" },
  hide: { icon: EyeOffIcon, variant: "outline" },
  restore: { icon: RotateCcwIcon, variant: "outline" },
  delete: { icon: Trash2Icon, variant: "destructive" },
};

function actionPastTense(action: BulkAction) {
  return action === "approve" ? "approved" : action === "reject" ? "rejected" : "held";
}

function RuleSelect<T extends string>({
  label,
  value,
  options,
  onValueChange,
  className,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onValueChange: (value: T) => void;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(next) => {
      if (typeof next === "string" && options.some((option) => option.value === next)) {
        onValueChange(next as T);
      }
    }}>
      <SelectTrigger aria-label={label} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function CommentModeration({
  locale,
  canManageGlobalModeration,
}: {
  locale: Locale;
  canManageGlobalModeration: boolean;
}) {
  const t = getAdminCopy(locale);
  const [filter, setFilter] = useState<Filter>("pending");
  const [comments, setComments] = useState<ModComment[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<ModComment | null>(null);
  const [rules, setRules] = useState<KeywordRule[]>([]);
  const [ruleDraft, setRuleDraft] = useState<RuleDraft>(EMPTY_RULE);
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [editingRule, setEditingRule] = useState<RuleDraft>(EMPTY_RULE);
  const [ruleBusy, setRuleBusy] = useState<string | null>(null);

  const load = useCallback(async (nextFilter: Filter) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/comments?status=${nextFilter}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
      const nextComments = json.comments as ModComment[];
      setComments(nextComments);
      setSelectedIds((current) => new Set([...current].filter((id) => nextComments.some((comment) => comment.id === id))));
      setCounts(json.counts || {});
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRules = useCallback(async () => {
    if (!canManageGlobalModeration) return;
    try {
      const res = await fetch("/api/admin/comments/keyword-rules");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
      setRules(json.rules as KeywordRule[]);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [canManageGlobalModeration]);

  useEffect(() => {
    // load() only setStates inside async continuations (after fetch), not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(filter);
  }, [filter, load]);

  useEffect(() => {
    if (!canManageGlobalModeration) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRules();
  }, [canManageGlobalModeration, loadRules]);

  function actionLabel(action: ModerationAction) {
    return action === "hold" ? "Hold" : t.comments.actions[action];
  }

  function actionNotice(action: ModerationAction) {
    return action === "hold" ? "Comment held successfully." : t.comments.done[action] || t.comments.done.fallback;
  }

  async function moderate(id: number, action: ModerationAction) {
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
      setNotice(actionNotice(action));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function moderateSelected(action: BulkAction) {
    if (!selectedIds.size) return;
    setBulkBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/comments/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selectedIds], action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
      const failed = (json.failed as Array<{ id: string | number; error: string }>).map((item) => `#${item.id}: ${item.error}`);
      setNotice(
        `${json.updated.length} ${json.updated.length === 1 ? "comment" : "comments"} ${actionPastTense(action)}.${
          failed.length ? ` ${failed.join(", ")}` : ""
        }`,
      );
      await load(filter);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBulkBusy(false);
    }
  }

  async function createRule() {
    setRuleBusy("create");
    setError(null);
    try {
      const res = await fetch("/api/admin/comments/keyword-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ruleDraft),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
      setRuleDraft(EMPTY_RULE);
      await loadRules();
      setNotice("Keyword rule added.");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setRuleBusy(null);
    }
  }

  async function updateRule(id: number, patch: Partial<KeywordRule>) {
    setRuleBusy(String(id));
    setError(null);
    try {
      const res = await fetch(`/api/admin/comments/keyword-rules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
      setRules((current) => current.map((rule) => (rule.id === id ? json.rule as KeywordRule : rule)));
      setEditingRuleId(null);
      setNotice("Keyword rule updated.");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setRuleBusy(null);
    }
  }

  const allSelected = comments.length > 0 && comments.every((comment) => selectedIds.has(comment.id));

  return (
    <div className="flex flex-col gap-4">
      {canManageGlobalModeration ? (
        <section className="border-y py-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Keyword watchlist</h2>
            <Badge variant="outline" className="tabular-nums">{rules.length}</Badge>
          </div>
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_110px_110px_110px_auto]">
            <Input
              aria-label="Keyword phrase"
              value={ruleDraft.phrase}
              maxLength={160}
              onChange={(event) => setRuleDraft((current) => ({ ...current, phrase: event.target.value }))}
              placeholder="Keyword phrase"
            />
            <RuleSelect
              label="Keyword locale"
              className="w-full"
              value={ruleDraft.locale}
              options={LOCALE_OPTIONS}
              onValueChange={(locale) => setRuleDraft((current) => ({ ...current, locale }))}
            />
            <RuleSelect
              label="Keyword scope"
              className="w-full"
              value={ruleDraft.scope}
              options={SCOPE_OPTIONS}
              onValueChange={(scope) => setRuleDraft((current) => ({ ...current, scope }))}
            />
            <RuleSelect
              label="Keyword action"
              className="w-full"
              value={ruleDraft.action}
              options={RULE_ACTION_OPTIONS}
              onValueChange={(action) => setRuleDraft((current) => ({ ...current, action }))}
            />
            <Button size="sm" disabled={ruleBusy !== null || !ruleDraft.phrase.trim()} onClick={() => void createRule()}>
              {ruleBusy === "create" ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <PlusIcon data-icon="inline-start" />}
              Add rule
            </Button>
          </div>
          {rules.length ? (
            <ul className="mt-3 divide-y border-t">
              {rules.map((rule) => {
                const editing = editingRuleId === rule.id;
                const busy = ruleBusy === String(rule.id);
                return (
                  <li key={rule.id} className="flex flex-wrap items-center gap-2 py-2">
                    {editing ? (
                      <>
                        <Input
                          aria-label={`Keyword phrase ${rule.id}`}
                          value={editingRule.phrase}
                          maxLength={160}
                          className="min-w-44 flex-1"
                          onChange={(event) => setEditingRule((current) => ({ ...current, phrase: event.target.value }))}
                        />
                        <RuleSelect
                          label={`Keyword locale ${rule.id}`}
                          className="w-28"
                          value={editingRule.locale}
                          options={LOCALE_OPTIONS}
                          onValueChange={(locale) => setEditingRule((current) => ({ ...current, locale }))}
                        />
                        <RuleSelect
                          label={`Keyword scope ${rule.id}`}
                          className="w-28"
                          value={editingRule.scope}
                          options={SCOPE_OPTIONS}
                          onValueChange={(scope) => setEditingRule((current) => ({ ...current, scope }))}
                        />
                        <RuleSelect
                          label={`Keyword action ${rule.id}`}
                          className="w-28"
                          value={editingRule.action}
                          options={RULE_ACTION_OPTIONS}
                          onValueChange={(action) => setEditingRule((current) => ({ ...current, action }))}
                        />
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                size="icon-sm"
                                disabled={busy || !editingRule.phrase.trim()}
                                aria-label="Save keyword rule"
                                onClick={() => void updateRule(rule.id, editingRule)}
                              />
                            }
                          >
                            {busy ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
                          </TooltipTrigger>
                          <TooltipContent>Save rule</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger
                            render={<Button size="icon-sm" variant="ghost" aria-label="Cancel keyword edit" onClick={() => setEditingRuleId(null)} />}
                          >
                            <XIcon />
                          </TooltipTrigger>
                          <TooltipContent>Cancel</TooltipContent>
                        </Tooltip>
                      </>
                    ) : (
                      <>
                        <span className="min-w-44 flex-1 break-words text-sm font-medium" dir="auto">{rule.phrase}</span>
                        <Badge variant="outline">{rule.locale}</Badge>
                        <Badge variant="outline">{rule.scope}</Badge>
                        <Badge variant={rule.action === "hold" ? "destructive" : "secondary"}>{rule.action}</Badge>
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Checkbox
                            checked={rule.enabled}
                            disabled={busy}
                            onCheckedChange={(checked) => void updateRule(rule.id, { enabled: Boolean(checked) })}
                          />
                          {rule.enabled ? "Enabled" : "Disabled"}
                        </label>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                disabled={busy}
                                aria-label="Edit keyword rule"
                                onClick={() => {
                                  setEditingRuleId(rule.id);
                                  setEditingRule({
                                    phrase: rule.phrase,
                                    locale: rule.locale,
                                    scope: rule.scope,
                                    action: rule.action,
                                  });
                                }}
                              />
                            }
                          >
                            <PencilIcon />
                          </TooltipTrigger>
                          <TooltipContent>Edit rule</TooltipContent>
                        </Tooltip>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((nextFilter) => (
          <Button key={nextFilter} variant={nextFilter === filter ? "default" : "outline"} size="sm" onClick={() => setFilter(nextFilter)}>
            {t.comments.filters[nextFilter]}
            {counts[nextFilter] != null ? <span className="ms-1 tabular-nums opacity-70">{counts[nextFilter]}</span> : null}
          </Button>
        ))}
      </div>

      {canManageGlobalModeration && comments.length ? (
        <div className="flex flex-wrap items-center gap-2 border-y py-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={allSelected}
              onCheckedChange={(checked) => setSelectedIds(checked ? new Set(comments.map((comment) => comment.id)) : new Set())}
            />
            {selectedIds.size} selected
          </label>
          <Button size="sm" disabled={bulkBusy || selectedIds.size === 0} onClick={() => void moderateSelected("approve")}>
            {bulkBusy ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <CheckIcon data-icon="inline-start" />}
            Approve
          </Button>
          <Button size="sm" variant="outline" disabled={bulkBusy || selectedIds.size === 0} onClick={() => void moderateSelected("hold")}>
            <PauseCircleIcon data-icon="inline-start" />
            Hold
          </Button>
          <Button size="sm" variant="outline" disabled={bulkBusy || selectedIds.size === 0} onClick={() => void moderateSelected("reject")}>
            <XIcon data-icon="inline-start" />
            Reject
          </Button>
        </div>
      ) : null}

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

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" /> {t.common.loading}
        </div>
      ) : comments.length === 0 ? (
        <p className="rounded-md border border-dashed p-5 text-center text-sm text-muted-foreground sm:p-8">
          {t.comments.noComments(t.comments.filters[filter])}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((comment) => (
            <li key={comment.id} className="flex flex-col gap-2 rounded-lg border p-4">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                {canManageGlobalModeration ? (
                  <Checkbox
                    aria-label={`Select comment ${comment.id}`}
                    checked={selectedIds.has(comment.id)}
                    onCheckedChange={(checked) => setSelectedIds((current) => {
                      const next = new Set(current);
                      if (checked) next.add(comment.id);
                      else next.delete(comment.id);
                      return next;
                    })}
                  />
                ) : null}
                <AuthorAvatar name={comment.authorName} avatarUrl={comment.authorAvatarUrl} className="size-7" />
                <span className="font-medium">{comment.authorName || t.comments.authorFallback}</span>
                <span className="text-xs text-muted-foreground">({comment.discordUserId})</span>
                <span aria-hidden>·</span>
                <span className="text-xs text-muted-foreground">
                  <LocalDateTime value={comment.createdAt} locale={locale} />
                </span>
                <Badge variant="outline">{t.comments.filters[comment.status]}</Badge>
                {comment.reportCount > 0 ? (
                  <Badge variant="destructive" className="gap-1">
                    <FlagIcon className="size-3" />
                    {t.comments.reports(comment.reportCount)}
                  </Badge>
                ) : null}
                {comment.parentCommentId ? <Badge variant="secondary">{t.comments.reply}</Badge> : null}
              </div>

              <div className="text-xs text-muted-foreground">
                {t.comments.onPost}{" "}
                <a
                  href={localizedPath(comment.targetType === "news" ? `/admin/news/${comment.targetId}` : `/matches/${comment.targetId}`, locale)}
                  className="underline-offset-2 hover:underline"
                >
                  {comment.targetTitle || (comment.targetType === "news" ? t.comments.postFallback(comment.targetId) : t.comments.matchFallback(comment.targetId))}
                </a>
              </div>

              <p dir="auto" className="bidi-plaintext whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-sm">
                {comment.body}
              </p>

              {comment.flagReason ? (
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {comment.flagReason.profanity?.length ? (
                    <Badge variant="destructive">{t.comments.profanity}: {comment.flagReason.profanity.join(", ")}</Badge>
                  ) : null}
                  {comment.flagReason.links?.length ? (
                    <Badge variant="outline">{t.comments.links}: {comment.flagReason.links.join(", ")}</Badge>
                  ) : null}
                  {comment.flagReason.keywordRules?.length ? (
                    <Badge variant="secondary">
                      Watchlist: {comment.flagReason.keywordRules.map((rule) => `${rule.phrase} (${rule.action})`).join(", ")}
                    </Badge>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-1.5 pt-1">
                {(ACTIONS[comment.status] || ["delete"] as ModerationAction[]).map((action) => {
                  const meta = ACTION_META[action];
                  return (
                    <Button
                      key={action}
                      size="sm"
                      variant={meta.variant ?? "default"}
                      disabled={busyId === comment.id || bulkBusy}
                      onClick={() => {
                        if (action === "delete") setDeleteTarget(comment);
                        else void moderate(comment.id, action);
                      }}
                    >
                      <meta.icon data-icon="inline-start" />
                      {actionLabel(action)}
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
        title={t.comments.deleteTitle}
        description={t.comments.deleteDescription}
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
