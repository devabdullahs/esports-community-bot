"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArchiveIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  TrophyIcon,
} from "lucide-react";
import { DateTime } from "@/components/date-time";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Locale } from "@/lib/i18n";

type Tournament = {
  id: number;
  source: string;
  externalId: string;
  name: string | null;
  effectiveName: string;
  url: string | null;
  game: string | null;
  effectiveGame: string | null;
  ewc: boolean;
  effectiveEwc: boolean;
  displayNameOverride: string | null;
  gameOverride: string | null;
  ewcOverride: boolean | null;
  active: boolean;
  archivedAt: number | null;
  runningCount: number;
  scheduledCount: number;
  finishedCount: number;
};

type Health = {
  tournamentId: number;
  dataKind: string;
  source: string;
  supported: boolean;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastFailureCategory: string | null;
  consecutiveFailures: number;
  lastItemCount: number | null;
};

type Operation = {
  id: string;
  tournamentId: number | null;
  operation: string;
  source: string | null;
  sourceId: string | null;
  game: string | null;
  status: string;
  attempts: number;
  requestedAt: string;
  completedAt: string | null;
  resultCode: string | null;
  failureCode: string | null;
  resultTournamentId: number | null;
};

type Game = { slug: string; label: string };
type LifecycleIntent = "archive" | "deactivate" | "reactivate";

const COPY = {
  en: {
    addTitle: "Track a tournament",
    addDescription:
      "Validation runs in the bot worker. The tournament becomes active only after its provider identity succeeds.",
    sourceInput: "Tournament URL or identifier",
    sourcePlaceholder: "Liquipedia URL, start.gg event URL, or PandaScore id",
    game: "Game override",
    automatic: "Detect automatically",
    queueValidation: "Queue validation",
    notConfigured: "Tournament operations require DISCORD_GUILD_ID.",
    registry: "Tournament registry",
    registryDescription: "Search every active, inactive, and archived tournament in this guild.",
    search: "Search tournaments",
    source: "Source",
    lifecycle: "Lifecycle",
    all: "All",
    active: "Active",
    inactive: "Inactive",
    archived: "Archived",
    tournament: "Tournament",
    health: "Data health",
    matches: "Matches",
    latestOperation: "Latest operation",
    actions: "Actions",
    live: "live",
    upcoming: "upcoming",
    results: "results",
    noRows: "No tournaments match these filters.",
    schedule: "Schedule",
    standings: "Standings",
    healthy: "Healthy",
    degraded: "Needs attention",
    waiting: "Not synced",
    unsupported: "Unsupported",
    queueSchedule: "Sync schedule",
    queueStandings: "Sync standings",
    editMetadata: "Edit metadata",
    deactivate: "Deactivate",
    archive: "Archive",
    reactivate: "Reactivate",
    openTournament: "Open tournament",
    openSource: "Open source",
    metadataTitle: "Tournament metadata",
    metadataDescription:
      "Overrides are reversible. Clear a value to inherit the provider metadata again.",
    displayName: "Display name override",
    inheritedName: "Inherit provider name",
    ewc: "EWC classification",
    inherit: "Inherit",
    yes: "EWC",
    no: "Not EWC",
    save: "Save changes",
    cancel: "Cancel",
    confirmTitle: "Confirm tournament change",
    confirmArchive:
      "Archive this tournament and stop all current tracking. Historical data remains available.",
    confirmDeactivate:
      "Deactivate this tournament and stop current tracking without marking it archived.",
    confirmReactivate: "Reactivate this tournament and resume tracking with a new lifecycle generation.",
    confirm: "Confirm",
    recent: "Recent operations",
    request: "Request",
    status: "Status",
    attempts: "Attempts",
    requested: "Requested",
    result: "Result",
    retry: "Retry",
    success: "Request queued",
    metadataSaved: "Metadata saved",
    failed: "Action failed",
    queued: "Queued",
    running: "Running",
    succeeded: "Succeeded",
    failedStatus: "Failed",
  },
  ar: {
    addTitle: "تتبع بطولة",
    addDescription:
      "يجري التحقق داخل عامل البوت، ولا تصبح البطولة نشطة إلا بعد نجاح التحقق من هوية المصدر.",
    sourceInput: "رابط البطولة أو المعرّف",
    sourcePlaceholder: "رابط Liquipedia أو حدث start.gg أو معرّف PandaScore",
    game: "تجاوز اللعبة",
    automatic: "اكتشاف تلقائي",
    queueValidation: "إضافة للتحقق",
    notConfigured: "تتطلب عمليات البطولات إعداد DISCORD_GUILD_ID.",
    registry: "سجل البطولات",
    registryDescription: "ابحث في البطولات النشطة وغير النشطة والمؤرشفة لهذا السيرفر.",
    search: "البحث في البطولات",
    source: "المصدر",
    lifecycle: "دورة الحياة",
    all: "الكل",
    active: "نشطة",
    inactive: "غير نشطة",
    archived: "مؤرشفة",
    tournament: "البطولة",
    health: "صحة البيانات",
    matches: "المباريات",
    latestOperation: "آخر عملية",
    actions: "الإجراءات",
    live: "مباشرة",
    upcoming: "قادمة",
    results: "نتائج",
    noRows: "لا توجد بطولات تطابق عوامل التصفية.",
    schedule: "الجدول",
    standings: "الترتيب",
    healthy: "سليمة",
    degraded: "تحتاج انتباه",
    waiting: "لم تتم المزامنة",
    unsupported: "غير مدعومة",
    queueSchedule: "مزامنة الجدول",
    queueStandings: "مزامنة الترتيب",
    editMetadata: "تعديل البيانات",
    deactivate: "إلغاء التنشيط",
    archive: "أرشفة",
    reactivate: "إعادة التنشيط",
    openTournament: "فتح البطولة",
    openSource: "فتح المصدر",
    metadataTitle: "بيانات البطولة",
    metadataDescription: "التجاوزات قابلة للعكس. امسح القيمة للعودة إلى بيانات المصدر.",
    displayName: "تجاوز اسم العرض",
    inheritedName: "استخدام اسم المصدر",
    ewc: "تصنيف كأس العالم للرياضات الإلكترونية",
    inherit: "موروث",
    yes: "بطولة EWC",
    no: "ليست EWC",
    save: "حفظ التغييرات",
    cancel: "إلغاء",
    confirmTitle: "تأكيد تغيير البطولة",
    confirmArchive: "أرشفة البطولة وإيقاف تتبعها الحالي مع إبقاء بياناتها التاريخية.",
    confirmDeactivate: "إلغاء تنشيط البطولة وإيقاف تتبعها دون أرشفتها.",
    confirmReactivate: "إعادة تنشيط البطولة واستئناف التتبع بجيل جديد.",
    confirm: "تأكيد",
    recent: "العمليات الأخيرة",
    request: "الطلب",
    status: "الحالة",
    attempts: "المحاولات",
    requested: "وقت الطلب",
    result: "النتيجة",
    retry: "إعادة المحاولة",
    success: "تمت إضافة الطلب",
    metadataSaved: "تم حفظ البيانات",
    failed: "تعذر تنفيذ الإجراء",
    queued: "في القائمة",
    running: "قيد التنفيذ",
    succeeded: "ناجحة",
    failedStatus: "فشلت",
  },
} as const;

function lifecycle(tournament: Tournament) {
  if (tournament.archivedAt != null) return "archived";
  return tournament.active ? "active" : "inactive";
}

function operationVariant(status: string) {
  if (status === "failed") return "destructive" as const;
  if (status === "succeeded") return "default" as const;
  return "secondary" as const;
}

function healthVariant(row: Health | undefined) {
  if (!row || row.lastAttemptAt == null) return "outline" as const;
  if (!row.supported) return "secondary" as const;
  if (row.consecutiveFailures > 0) return "destructive" as const;
  return "default" as const;
}

function healthLabel(row: Health | undefined, t: (typeof COPY)[Locale]) {
  if (!row || row.lastAttemptAt == null) return t.waiting;
  if (!row.supported) return t.unsupported;
  if (row.consecutiveFailures > 0) return t.degraded;
  return t.healthy;
}

async function jsonRequest(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

export function TournamentOperationsCenter({
  locale,
  configured,
  tournaments,
  health,
  operations,
  games,
}: {
  locale: Locale;
  configured: boolean;
  tournaments: Tournament[];
  health: Health[];
  operations: Operation[];
  games: Game[];
}) {
  const router = useRouter();
  const t = COPY[locale];
  const [isPending, startTransition] = useTransition();
  const [isMutating, setIsMutating] = useState(false);
  const [input, setInput] = useState("");
  const [game, setGame] = useState("auto");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [state, setState] = useState("all");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [metadataTournament, setMetadataTournament] = useState<Tournament | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [metadataGame, setMetadataGame] = useState("inherit");
  const [metadataEwc, setMetadataEwc] = useState("inherit");
  const [confirmAction, setConfirmAction] = useState<{
    tournament: Tournament;
    intent: LifecycleIntent;
  } | null>(null);

  const healthByTournament = useMemo(() => {
    const map = new Map<string, Health>();
    for (const row of health) map.set(`${row.tournamentId}:${row.dataKind}`, row);
    return map;
  }, [health]);
  const latestOperation = useMemo(() => {
    const map = new Map<number, Operation>();
    for (const operation of operations) {
      const tournamentId = operation.tournamentId ?? operation.resultTournamentId;
      if (tournamentId != null && !map.has(tournamentId)) {
        map.set(tournamentId, operation);
      }
    }
    return map;
  }, [operations]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tournaments.filter((tournament) => {
      if (source !== "all" && tournament.source !== source) return false;
      if (state !== "all" && lifecycle(tournament) !== state) return false;
      if (!needle) return true;
      return [
        tournament.effectiveName,
        tournament.externalId,
        tournament.effectiveGame,
        tournament.source,
      ].some((value) => String(value || "").toLowerCase().includes(needle));
    });
  }, [query, source, state, tournaments]);

  function refreshWith(messageText: string) {
    setMessage({ kind: "success", text: messageText });
    startTransition(() => router.refresh());
  }

  async function queueOperation(intent: string, tournamentId?: number) {
    if (isMutating) return;
    setIsMutating(true);
    setMessage(null);
    try {
      await jsonRequest("/api/admin/tournaments/operations", {
        method: "POST",
        body: JSON.stringify({
          intent,
          ...(tournamentId ? { tournamentId } : {}),
          nonce: crypto.randomUUID(),
        }),
      });
      refreshWith(t.success);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : t.failed });
    } finally {
      setIsMutating(false);
    }
  }

  async function addTournament() {
    if (!input.trim() || isMutating) return;
    setIsMutating(true);
    setMessage(null);
    try {
      await jsonRequest("/api/admin/tournaments/operations", {
        method: "POST",
        body: JSON.stringify({
          intent: "validate_and_activate",
          input: input.trim(),
          game: game === "auto" ? null : game,
          nonce: crypto.randomUUID(),
        }),
      });
      setInput("");
      refreshWith(t.success);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : t.failed });
    } finally {
      setIsMutating(false);
    }
  }

  function editMetadata(tournament: Tournament) {
    setMetadataTournament(tournament);
    setDisplayName(tournament.displayNameOverride || "");
    setMetadataGame(tournament.gameOverride || "inherit");
    setMetadataEwc(
      tournament.ewcOverride == null ? "inherit" : tournament.ewcOverride ? "yes" : "no",
    );
  }

  async function saveMetadata() {
    if (!metadataTournament || isMutating) return;
    setIsMutating(true);
    setMessage(null);
    try {
      await jsonRequest(`/api/admin/tournaments/${metadataTournament.id}/metadata`, {
        method: "PATCH",
        body: JSON.stringify({
          displayName: displayName.trim() || null,
          game: metadataGame === "inherit" ? null : metadataGame,
          ewc: metadataEwc === "inherit" ? null : metadataEwc === "yes",
        }),
      });
      setMetadataTournament(null);
      refreshWith(t.metadataSaved);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : t.failed });
    } finally {
      setIsMutating(false);
    }
  }

  async function retry(operationId: string) {
    if (isMutating) return;
    setIsMutating(true);
    setMessage(null);
    try {
      await jsonRequest("/api/admin/tournaments/operations", {
        method: "POST",
        body: JSON.stringify({ intent: "retry_operation", operationId }),
      });
      refreshWith(t.success);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : t.failed });
    } finally {
      setIsMutating(false);
    }
  }

  const statusCopy: Record<string, string> = {
    queued: t.queued,
    running: t.running,
    succeeded: t.succeeded,
    failed: t.failedStatus,
  };

  return (
    <>
      {!configured ? (
        <Alert variant="destructive">
          <AlertTitle>{t.failed}</AlertTitle>
          <AlertDescription>{t.notConfigured}</AlertDescription>
        </Alert>
      ) : null}
      {message ? (
        <Alert variant={message.kind === "error" ? "destructive" : "default"}>
          <AlertTitle>{message.kind === "error" ? t.failed : t.success}</AlertTitle>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t.addTitle}</CardTitle>
          <p className="text-sm text-muted-foreground">{t.addDescription}</p>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid gap-4 lg:grid-cols-[minmax(20rem,1fr)_18rem_auto] lg:items-end">
            <Field>
              <FieldLabel htmlFor="tournament-source">{t.sourceInput}</FieldLabel>
              <Input
                id="tournament-source"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={t.sourcePlaceholder}
                disabled={!configured || isPending || isMutating}
              />
            </Field>
            <Field>
              <FieldLabel>{t.game}</FieldLabel>
              <Select value={game} onValueChange={(value) => setGame(value || "auto")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t.automatic}</SelectItem>
                  {games.map((entry) => (
                    <SelectItem key={entry.slug} value={entry.slug}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Button
              type="button"
              onClick={addTournament}
              disabled={!configured || !input.trim() || isPending || isMutating}
            >
              <PlusIcon />
              {t.queueValidation}
            </Button>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.registry}</CardTitle>
          <p className="text-sm text-muted-foreground">{t.registryDescription}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(18rem,1fr)_12rem_12rem]">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                data-testid="tournament-registry-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t.search}
                className="ps-9"
              />
            </div>
            <Select value={source} onValueChange={(value) => setSource(value || "all")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.all} {t.source}</SelectItem>
                <SelectItem value="liquipedia">Liquipedia</SelectItem>
                <SelectItem value="startgg">start.gg</SelectItem>
                <SelectItem value="pandascore">PandaScore</SelectItem>
              </SelectContent>
            </Select>
            <Select value={state} onValueChange={(value) => setState(value || "all")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.all} {t.lifecycle}</SelectItem>
                <SelectItem value="active">{t.active}</SelectItem>
                <SelectItem value="inactive">{t.inactive}</SelectItem>
                <SelectItem value="archived">{t.archived}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {filtered.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon"><TrophyIcon /></EmptyMedia>
                <EmptyTitle>{t.noRows}</EmptyTitle>
                <EmptyDescription>{t.registryDescription}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.tournament}</TableHead>
                    <TableHead>{t.lifecycle}</TableHead>
                    <TableHead>{t.health}</TableHead>
                    <TableHead>{t.matches}</TableHead>
                    <TableHead>{t.latestOperation}</TableHead>
                    <TableHead className="w-12"><span className="sr-only">{t.actions}</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((tournament) => {
                    const schedule = healthByTournament.get(`${tournament.id}:schedule`);
                    const standings = healthByTournament.get(`${tournament.id}:standings`);
                    const operation = latestOperation.get(tournament.id);
                    const lifecycleState = lifecycle(tournament);
                    return (
                      <TableRow key={tournament.id}>
                        <TableCell className="min-w-72">
                          <div className="flex min-w-0 items-start gap-3">
                            <div className="min-w-0">
                              <Link
                                href={`/tournaments/${tournament.id}`}
                                className="block truncate font-medium hover:underline"
                              >
                                {tournament.effectiveName}
                              </Link>
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                #{tournament.id} · {tournament.source} · {tournament.effectiveGame || t.automatic}
                                {tournament.effectiveEwc ? " · EWC" : ""}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={lifecycleState === "active" ? "default" : "secondary"}>
                            {t[lifecycleState]}
                          </Badge>
                        </TableCell>
                        <TableCell className="min-w-52">
                          <div className="flex flex-wrap gap-1.5">
                            <Badge variant={healthVariant(schedule)}>
                              {t.schedule}: {healthLabel(schedule, t)}
                            </Badge>
                            <Badge variant={healthVariant(standings)}>
                              {t.standings}: {healthLabel(standings, t)}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="min-w-48 text-xs text-muted-foreground">
                          <span className="text-foreground">{tournament.runningCount}</span> {t.live}
                          {" · "}
                          <span className="text-foreground">{tournament.scheduledCount}</span> {t.upcoming}
                          {" · "}
                          <span className="text-foreground">{tournament.finishedCount}</span> {t.results}
                        </TableCell>
                        <TableCell className="min-w-44">
                          {operation ? (
                            <div>
                              <Badge variant={operationVariant(operation.status)}>
                                {statusCopy[operation.status] || operation.status}
                              </Badge>
                              <p className="mt-1 text-xs text-muted-foreground">{operation.operation}</p>
                            </div>
                          ) : "-"}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={<Button variant="ghost" size="icon-sm" aria-label={t.actions} />}
                            >
                              <MoreHorizontalIcon />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                              <DropdownMenuItem
                                disabled={isMutating}
                                onClick={() => queueOperation("sync_schedule", tournament.id)}
                              >
                                <RefreshCwIcon /> {t.queueSchedule}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={isMutating}
                                onClick={() => queueOperation("sync_standings", tournament.id)}
                              >
                                <RefreshCwIcon /> {t.queueStandings}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => editMetadata(tournament)}>
                                <PencilIcon /> {t.editMetadata}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem render={<Link href={`/tournaments/${tournament.id}`} />}>
                                <PlayIcon /> {t.openTournament}
                              </DropdownMenuItem>
                              {tournament.url ? (
                                <DropdownMenuItem
                                  render={<a href={tournament.url} target="_blank" rel="noreferrer" />}
                                >
                                  <ExternalLinkIcon /> {t.openSource}
                                </DropdownMenuItem>
                              ) : null}
                              <DropdownMenuSeparator />
                              {lifecycleState === "active" ? (
                                <>
                                  <DropdownMenuItem
                                    onClick={() => setConfirmAction({ tournament, intent: "deactivate" })}
                                  >
                                    <ChevronDownIcon /> {t.deactivate}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onClick={() => setConfirmAction({ tournament, intent: "archive" })}
                                  >
                                    <ArchiveIcon /> {t.archive}
                                  </DropdownMenuItem>
                                </>
                              ) : (
                                <DropdownMenuItem
                                  onClick={() => setConfirmAction({ tournament, intent: "reactivate" })}
                                >
                                  <RotateCcwIcon /> {t.reactivate}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t.recent}</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.request}</TableHead>
                  <TableHead>{t.tournament}</TableHead>
                  <TableHead>{t.status}</TableHead>
                  <TableHead className="text-end">{t.attempts}</TableHead>
                  <TableHead>{t.requested}</TableHead>
                  <TableHead>{t.result}</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {operations.slice(0, 30).map((operation) => {
                  const tournament = tournaments.find((item) => item.id === operation.tournamentId);
                  return (
                    <TableRow key={operation.id}>
                      <TableCell>
                        <p className="font-medium">{operation.operation}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">{operation.id.slice(0, 8)}</p>
                      </TableCell>
                      <TableCell>{tournament?.effectiveName || operation.sourceId || "-"}</TableCell>
                      <TableCell>
                        <Badge variant={operationVariant(operation.status)}>
                          {statusCopy[operation.status] || operation.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{operation.attempts}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {operation.requestedAt ? <DateTime value={operation.requestedAt} locale={locale} /> : "-"}
                      </TableCell>
                      <TableCell>{operation.resultCode || operation.failureCode || "-"}</TableCell>
                      <TableCell>
                        {operation.status === "failed" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isMutating}
                            onClick={() => retry(operation.id)}
                          >
                            <RotateCcwIcon /> {t.retry}
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {operations.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                      {t.waiting}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Sheet open={Boolean(metadataTournament)} onOpenChange={(open) => !open && setMetadataTournament(null)}>
        <SheetContent side={locale === "ar" ? "left" : "right"} className="overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t.metadataTitle}</SheetTitle>
            <SheetDescription>{t.metadataDescription}</SheetDescription>
          </SheetHeader>
          <div className="px-4">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="metadata-name">{t.displayName}</FieldLabel>
                <Input
                  id="metadata-name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder={metadataTournament?.name || t.inheritedName}
                  maxLength={180}
                />
                <FieldDescription>{t.inheritedName}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>{t.game}</FieldLabel>
                <Select value={metadataGame} onValueChange={(value) => setMetadataGame(value || "inherit")}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">{t.inherit}</SelectItem>
                    {games.map((entry) => (
                      <SelectItem key={entry.slug} value={entry.slug}>{entry.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>{t.ewc}</FieldLabel>
                <Select value={metadataEwc} onValueChange={(value) => setMetadataEwc(value || "inherit")}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">{t.inherit}</SelectItem>
                    <SelectItem value="yes">{t.yes}</SelectItem>
                    <SelectItem value="no">{t.no}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setMetadataTournament(null)}>{t.cancel}</Button>
            <Button onClick={saveMetadata} disabled={isPending || isMutating}>{t.save}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={Boolean(confirmAction)}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title={t.confirmTitle}
        description={
          confirmAction?.intent === "archive"
            ? t.confirmArchive
            : confirmAction?.intent === "deactivate"
              ? t.confirmDeactivate
              : t.confirmReactivate
        }
        cancelLabel={t.cancel}
        actions={[
          {
            label: t.confirm,
            variant: confirmAction?.intent === "archive" ? "destructive" : "default",
            onClick: () => {
              if (!confirmAction) return;
              const { tournament, intent } = confirmAction;
              setConfirmAction(null);
              void queueOperation(intent, tournament.id);
            },
          },
        ]}
      />
    </>
  );
}
