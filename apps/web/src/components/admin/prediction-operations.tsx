"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCwIcon, RotateCcwIcon, Trash2Icon, TrophyIcon } from "lucide-react";
import type { AdminPredictionOperationsModel, AdminPredictionRound } from "@/lib/admin-predictions";
import { predictionOperationRequest, type PredictionOperationName } from "@/lib/prediction-operation-model";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type PendingAction = { operation: PredictionOperationName; round: AdminPredictionRound | null } | null;

const COPY = {
  en: {
    active: "Active", awaiting: "Awaiting results", scored: "Scored", history: "Operation history",
    refresh: "Refresh leaderboard", score: "Score", reopen: "Reopen", delete: "Delete",
    title: "Prediction operations", description: "Durable actions run in the bot process and are recorded here.",
    noRounds: "No prediction rounds are configured for this season.", health: "Automation health",
    noHealth: "No operation or automation attempt has been recorded yet.", confirm: "Confirm operation", cancel: "Cancel", execute: "Queue operation",
    deleteTitle: "Delete this prediction week?", deleteHelp: "Type the exact week key to permanently delete its picks and scores.",
    actionHelp: "This queues a durable bot-side operation. It can be retried if it fails.", queued: "Queued", failed: "Failed", running: "Running", succeeded: "Succeeded",
    participants: "participants", scoredCount: "scored", source: "source", reminders: "reminders", error: "Last error", retry: "Retry", round: "Round", status: "Status", attempts: "Attempts", operation: "Operation",
    operationQueued: "Operation queued.", operationFailed: "Could not queue operation.", baseline: "baseline", final: "final", results: "results",
  },
  ar: {
    active: "النشطة", awaiting: "بانتظار النتائج", scored: "المحتسبة", history: "سجل العمليات",
    refresh: "حدّث لوحة الصدارة", score: "احتسب", reopen: "أعد الفتح", delete: "احذف",
    title: "عمليات التوقعات", description: "تعمل الإجراءات الدائمة في عملية البوت وتُسجل هنا.",
    noRounds: "لا توجد جولات توقعات مهيأة لهذا الموسم.", health: "حالة الأتمتة",
    noHealth: "لم تُسجل أي عملية أو محاولة أتمتة بعد.", confirm: "تأكيد العملية", cancel: "إلغاء", execute: "ضع العملية في الطابور",
    deleteTitle: "حذف أسبوع التوقعات؟", deleteHelp: "اكتب مفتاح الأسبوع كما هو لحذف توقعاته ودرجاته نهائيًا.",
    actionHelp: "سيؤدي ذلك إلى وضع عملية دائمة في طابور البوت ويمكن إعادة محاولتها عند الفشل.", queued: "في الطابور", failed: "فشلت", running: "قيد التنفيذ", succeeded: "نجحت",
    participants: "مشارك", scoredCount: "محتسب", source: "المصدر", reminders: "تذكيرات", error: "آخر خطأ", retry: "إعادة المحاولة", round: "الجولة", status: "الحالة", attempts: "المحاولات", operation: "العملية",
    operationQueued: "تمت إضافة العملية إلى الطابور.", operationFailed: "تعذرت إضافة العملية إلى الطابور.", baseline: "خط أساس", final: "نهائي", results: "نتائج",
  },
} as const;

function operationLabel(operation: string) {
  return operation.replaceAll("_", " ");
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "succeeded") return "default";
  if (status === "failed") return "destructive";
  if (status === "running") return "secondary";
  return "outline";
}

function roundSources(round: AdminPredictionRound, text: { baseline: string; final: string; results: string }) {
  return [
    `${text.baseline} ${round.baselineAvailable ? "✓" : "—"}`,
    `${text.final} ${round.finalAvailable ? "✓" : "—"}`,
    `${text.results} ${round.resultsAvailable ? "✓" : "—"}`,
  ].join(" · ");
}

export function PredictionOperations({ model, locale }: { model: AdminPredictionOperationsModel; locale: "en" | "ar" }) {
  const text = COPY[locale];
  const [pending, setPending] = useState<PendingAction>(null);
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const busyWeeks = useMemo(() => new Set(model.operations.filter((operation) => ["queued", "running"].includes(operation.status)).map((operation) => operation.targetWeekKey).filter((weekKey): weekKey is string => Boolean(weekKey))), [model.operations]);

  useEffect(() => {
    if (!model.operations.some((operation) => ["queued", "running"].includes(operation.status))) return;
    const timer = window.setTimeout(() => window.location.reload(), 4_000);
    return () => window.clearTimeout(timer);
  }, [model.operations]);

  const open = (operation: PredictionOperationName, round: AdminPredictionRound | null = null) => {
    setConfirmation("");
    setPending({ operation, round });
  };
  const submit = async () => {
    if (!pending) return;
    setSubmitting(true);
    try {
      const request = predictionOperationRequest(pending.operation, pending.round?.weekKey ?? null, confirmation);
      const response = await fetch("/api/admin/predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, idempotencyKey: crypto.randomUUID(), season: model.season }),
      });
      if (!response.ok) throw new Error();
      setNotice(text.operationQueued);
      setPending(null);
      window.setTimeout(() => window.location.reload(), 800);
    } catch {
      setNotice(text.operationFailed);
    } finally {
      setSubmitting(false);
    }
  };
  const retry = async (id: string) => {
    const response = await fetch(`/api/admin/predictions/${id}/retry`, { method: "POST" });
    setNotice(response.ok ? text.operationQueued : text.operationFailed);
    if (response.ok) window.setTimeout(() => window.location.reload(), 500);
  };
  const groups = {
    active: model.rounds.filter((round) => ["open", "partly open"].includes(round.effectiveStatus)),
    awaiting: model.rounds.filter((round) => !["open", "partly open", "scored"].includes(round.effectiveStatus)),
    scored: model.rounds.filter((round) => round.effectiveStatus === "scored"),
  };
  const table = (rounds: AdminPredictionRound[]) => rounds.length ? (
    <Table>
      <TableHeader><TableRow><TableHead>{text.round}</TableHead><TableHead>{text.status}</TableHead><TableHead>{text.source}</TableHead><TableHead>{text.participants}</TableHead><TableHead>{text.reminders}</TableHead><TableHead /></TableRow></TableHeader>
      <TableBody>{rounds.map((round) => <TableRow key={round.weekKey}>
        <TableCell><div className="flex flex-col gap-1"><span className="font-medium">{round.label}</span><span className="font-mono text-xs text-muted-foreground">{round.weekKey}</span></div></TableCell>
        <TableCell><Badge variant="secondary">{round.effectiveStatus}</Badge></TableCell>
        <TableCell className="text-xs text-muted-foreground">{roundSources(round, text)}</TableCell>
        <TableCell className="tabular-nums">{round.participantCount} / {round.scoredCount} {text.scoredCount}</TableCell>
        <TableCell className="tabular-nums">{round.reminders.sent} / {round.reminders.attempts}</TableCell>
        <TableCell><div className="flex flex-wrap justify-end gap-2">
          {round.effectiveStatus !== "scored" ? <Button size="sm" variant="outline" disabled={busyWeeks.has(round.weekKey)} onClick={() => open("score_week", round)}><TrophyIcon data-icon="inline-start" />{text.score}</Button> : null}
          {round.effectiveStatus === "scored" ? <Button size="sm" variant="outline" disabled={busyWeeks.has(round.weekKey)} onClick={() => open("reopen_week", round)}><RotateCcwIcon data-icon="inline-start" />{text.reopen}</Button> : null}
          <Button size="sm" variant="destructive" disabled={round.effectiveStatus === "scored" || busyWeeks.has(round.weekKey)} onClick={() => open("delete_week", round)}><Trash2Icon data-icon="inline-start" />{text.delete}</Button>
        </div></TableCell>
      </TableRow>)}</TableBody>
    </Table>
  ) : <Empty><EmptyHeader><EmptyTitle>{text.noRounds}</EmptyTitle></EmptyHeader></Empty>;

  const title = pending?.operation === "delete_week" ? text.deleteTitle : text.confirm;
  const description = pending?.operation === "delete_week" ? text.deleteHelp : text.actionHelp;
  const deleteReady = pending?.operation !== "delete_week" || confirmation === pending.round?.weekKey;
  return <div className="flex flex-col gap-5">
    <Card><CardHeader><CardTitle>{text.health}</CardTitle><CardDescription>{model.health?.lastAttemptAt || text.noHealth}</CardDescription></CardHeader><CardContent className="flex flex-col gap-2">
      {model.health?.lastError ? <p className="break-words text-sm text-destructive">{text.error}: {model.health.lastError}</p> : null}
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
      <div className="flex flex-wrap gap-2"><Button onClick={() => open("refresh_leaderboard")}><RefreshCwIcon data-icon="inline-start" />{text.refresh}</Button>{model.seasonRound && model.seasonRound.status !== "scored" ? <Button variant="outline" onClick={() => open("score_season")}><TrophyIcon data-icon="inline-start" />{text.score}</Button> : null}</div>
    </CardContent></Card>
    <Tabs defaultValue="active"><TabsList><TabsTrigger value="active">{text.active}</TabsTrigger><TabsTrigger value="awaiting">{text.awaiting}</TabsTrigger><TabsTrigger value="scored">{text.scored}</TabsTrigger><TabsTrigger value="history">{text.history}</TabsTrigger></TabsList>
      <TabsContent value="active">{table(groups.active)}</TabsContent><TabsContent value="awaiting">{table(groups.awaiting)}</TabsContent><TabsContent value="scored">{table(groups.scored)}</TabsContent>
      <TabsContent value="history"><Table><TableHeader><TableRow><TableHead>{text.operation}</TableHead><TableHead>{text.status}</TableHead><TableHead>{text.attempts}</TableHead><TableHead>{text.error}</TableHead><TableHead /></TableRow></TableHeader><TableBody>{model.operations.length ? model.operations.map((operation) => <TableRow key={operation.id}><TableCell className="font-mono text-xs">{operationLabel(operation.operation)}</TableCell><TableCell><Badge variant={statusVariant(operation.status)}>{text[operation.status as keyof typeof text] || operation.status}</Badge></TableCell><TableCell>{operation.attempts}</TableCell><TableCell className="max-w-sm break-words text-xs text-muted-foreground">{operation.error || "—"}</TableCell><TableCell>{operation.status === "failed" ? <Button size="sm" variant="outline" onClick={() => retry(operation.id)}>{text.retry}</Button> : null}</TableCell></TableRow>) : <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">{text.noHealth}</TableCell></TableRow>}</TableBody></Table></TabsContent>
    </Tabs>
    <ConfirmDialog open={Boolean(pending)} onOpenChange={(value) => !value && setPending(null)} title={title} description={description} cancelLabel={text.cancel} actions={[{ label: text.execute, variant: pending?.operation === "delete_week" ? "destructive" : "default", onClick: submit, disabled: submitting || !deleteReady }]}>
      {pending?.operation === "delete_week" && pending.round ? <Field><FieldLabel htmlFor="prediction-delete-confirmation">{pending.round.weekKey}</FieldLabel><Input id="prediction-delete-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /><FieldDescription>{text.deleteHelp}</FieldDescription></Field> : null}
    </ConfirmDialog>
  </div>;
}
