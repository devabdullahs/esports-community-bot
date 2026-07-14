import Link from "next/link";
import { redirect } from "next/navigation";
import { listActiveTournamentSyncHealth } from "@bot/db/tournamentSyncHealth.js";
import { adminTournamentSyncHealth, tournamentSyncSourceLabel } from "@bot/lib/tournamentSyncHealth.js";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { DateTime } from "@/components/date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { localizedPath, type Locale } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";
import { safeUrlOrUndefined } from "@/lib/safe-url";

const COPY = {
  en: {
    title: "Tournament source health",
    description: "Coarse health for active tournament schedule sources. Provider details are intentionally not stored here.",
    source: "Source",
    state: "State",
    apply: "Apply filters",
    empty: "No active tournaments match these filters.",
    tournament: "Tournament",
    lastAttempt: "Last attempt",
    lastSuccess: "Last success",
    failures: "Failures",
    category: "Category",
    items: "Items",
    openTournament: "Tournament",
    openSource: "Source",
    states: { fresh: "Fresh", delayed: "Delayed", unavailable: "Unavailable", final: "Final" },
    categories: {
      rate_limit: "Rate limited",
      auth: "Authorization",
      timeout: "Timeout",
      network: "Network",
      parse: "Parse",
      unknown: "Unknown",
      none: "-",
    },
  },
  ar: {
    title: "\u0635\u062d\u0629 \u0645\u0635\u0627\u062f\u0631 \u0627\u0644\u0628\u0637\u0648\u0644\u0627\u062a",
    description: "\u062d\u0627\u0644\u0629 \u0645\u062c\u0645\u0644\u0629 \u0644\u0645\u0635\u0627\u062f\u0631 \u062c\u062f\u0627\u0648\u0644 \u0627\u0644\u0628\u0637\u0648\u0644\u0627\u062a \u0627\u0644\u0646\u0634\u0637\u0629. \u0644\u0627 \u062a\u064f\u062e\u0632\u0651\u0646 \u062a\u0641\u0627\u0635\u064a\u0644 \u0627\u0644\u0645\u0632\u0648\u062f \u0647\u0646\u0627 \u0639\u0646 \u0642\u0635\u062f.",
    source: "\u0627\u0644\u0645\u0635\u062f\u0631",
    state: "\u0627\u0644\u062d\u0627\u0644\u0629",
    apply: "\u062a\u0637\u0628\u064a\u0642 \u0627\u0644\u0641\u0644\u0627\u062a\u0631",
    empty: "\u0644\u0627 \u062a\u0648\u062c\u062f \u0628\u0637\u0648\u0644\u0627\u062a \u0646\u0634\u0637\u0629 \u062a\u0637\u0627\u0628\u0642 \u0647\u0630\u0647 \u0627\u0644\u0641\u0644\u0627\u062a\u0631.",
    tournament: "\u0627\u0644\u0628\u0637\u0648\u0644\u0629",
    lastAttempt: "\u0622\u062e\u0631 \u0645\u062d\u0627\u0648\u0644\u0629",
    lastSuccess: "\u0622\u062e\u0631 \u0646\u062c\u0627\u062d",
    failures: "\u0627\u0644\u0625\u062e\u0641\u0627\u0642\u0627\u062a",
    category: "\u0627\u0644\u0641\u0626\u0629",
    items: "\u0627\u0644\u0639\u0646\u0627\u0635\u0631",
    openTournament: "\u0627\u0644\u0628\u0637\u0648\u0644\u0629",
    openSource: "\u0627\u0644\u0645\u0635\u062f\u0631",
    states: { fresh: "\u0645\u062d\u062f\u0651\u062b", delayed: "\u0645\u062a\u0623\u062e\u0631", unavailable: "\u063a\u064a\u0631 \u0645\u062a\u0627\u062d", final: "\u0646\u0647\u0627\u0626\u064a" },
    categories: {
      rate_limit: "\u062d\u062f \u0627\u0644\u0645\u0639\u062f\u0644",
      auth: "\u0627\u0644\u062a\u0641\u0648\u064a\u0636",
      timeout: "\u0627\u0646\u062a\u0647\u0627\u0621 \u0627\u0644\u0645\u0647\u0644\u0629",
      network: "\u0627\u0644\u0634\u0628\u0643\u0629",
      parse: "\u0627\u0644\u062a\u062d\u0644\u064a\u0644",
      unknown: "\u063a\u064a\u0631 \u0645\u0639\u0631\u0648\u0641",
      none: "-",
    },
  },
} as const;

type Source = "liquipedia" | "startgg" | "pandascore";
type State = "fresh" | "delayed" | "unavailable" | "final";
type FailureCategory = "rate_limit" | "auth" | "timeout" | "network" | "parse" | "unknown";
type AdminHealth = {
  state: State;
  source: Source;
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  consecutiveFailures: number;
  lastFailureCategory: FailureCategory | null;
  lastItemCount: number | null;
};
type AdminSourceHealthRow = {
  tournament_id: number;
  tournament_name: string | null;
  tournament_source: Source;
  tournament_url: string | null;
  tournament_game: string | null;
  archived_at: number | null;
  source: Source | null;
  last_attempt_at: number | null;
  last_success_at: number | null;
  last_failure_at: number | null;
  last_failure_category: FailureCategory | null;
  consecutive_failures: number | null;
  last_item_count: number | null;
  updated_at: number | null;
  has_running_match: number | boolean;
};
type AdminSourceHealthEntry = AdminSourceHealthRow & { health: AdminHealth };
const livePollIntervalMs = Number(process.env.LIVE_POLL_INTERVAL_MS || 300_000);

function selectedSource(value: string | undefined): Source | "all" {
  return value === "liquipedia" || value === "startgg" || value === "pandascore" ? value : "all";
}

function selectedState(value: string | undefined): State | "all" {
  return value === "fresh" || value === "delayed" || value === "unavailable" || value === "final" ? value : "all";
}

function stateVariant(state: State) {
  if (state === "fresh") return "default" as const;
  if (state === "unavailable") return "destructive" as const;
  return "secondary" as const;
}

function stateOrder(state: State) {
  return { unavailable: 0, delayed: 1, fresh: 2, final: 3 }[state];
}

function dateValue(seconds: number | null) {
  return seconds == null ? null : new Date(seconds * 1000);
}

export default async function AdminSourceHealthPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; state?: string }>;
}) {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/source-health");
  if (!access.isSuper) redirect("/admin");

  const [locale, params, rawRows] = await Promise.all([
    getRequestLocale(),
    searchParams,
    listActiveTournamentSyncHealth(),
  ]);
  const rows = rawRows as AdminSourceHealthRow[];
  const t = COPY[locale as Locale];
  const adminCopy = getAdminCopy(locale as Locale);
  const source = selectedSource(params.source);
  const state = selectedState(params.state);
  const entries = rows
    .map((row): AdminSourceHealthEntry => {
      const health = adminTournamentSyncHealth(
        { ...row, source: row.source ?? row.tournament_source },
        {
          source: row.tournament_source,
          archivedAt: row.archived_at,
          hasRunningMatch: Number(row.has_running_match) === 1,
          pollIntervalMs: livePollIntervalMs,
        },
      );
      return { ...row, health: health as AdminHealth };
    })
    .filter((entry) => source === "all" || entry.health.source === source)
    .filter((entry) => state === "all" || entry.health.state === state)
    .sort((a, b) =>
      stateOrder(a.health.state) - stateOrder(b.health.state) ||
      (b.health.lastAttemptAt ?? 0) - (a.health.lastAttemptAt ?? 0) ||
      a.tournament_id - b.tournament_id,
    );

  return (
    <AdminPageShell
      maxWidth="6xl"
      breadcrumbs={[
        { label: adminCopy.dashboard.title, href: "/admin" },
        { label: t.title },
      ]}
      eyebrow={adminCopy.common.superAdmin}
      title={t.title}
      description={t.description}
    >
      <Card>
        <CardContent className="pt-6">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1.5 text-sm font-medium">
              {t.source}
              <select name="source" defaultValue={source} className="h-9 min-w-36 rounded-md border bg-background px-2 text-sm">
                <option value="all">All</option>
                <option value="liquipedia">Liquipedia</option>
                <option value="startgg">start.gg</option>
                <option value="pandascore">PandaScore</option>
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              {t.state}
              <select name="state" defaultValue={state} className="h-9 min-w-36 rounded-md border bg-background px-2 text-sm">
                <option value="all">All</option>
                {(["unavailable", "delayed", "fresh", "final"] as State[]).map((value) => (
                  <option key={value} value={value}>{t.states[value]}</option>
                ))}
              </select>
            </label>
            <Button type="submit" size="sm">{t.apply}</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {entries.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">{t.empty}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.tournament}</TableHead>
                  <TableHead>{t.source}</TableHead>
                  <TableHead>{t.state}</TableHead>
                  <TableHead>{t.lastAttempt}</TableHead>
                  <TableHead>{t.lastSuccess}</TableHead>
                  <TableHead className="text-end">{t.failures}</TableHead>
                  <TableHead>{t.category}</TableHead>
                  <TableHead className="text-end">{t.items}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => {
                  const sourceUrl = safeUrlOrUndefined(entry.tournament_url);
                  return (
                    <TableRow key={entry.tournament_id}>
                      <TableCell className="max-w-48">
                        <Link href={localizedPath(`/tournaments/${entry.tournament_id}`, locale as Locale)} className="block truncate font-medium hover:underline">
                          {entry.tournament_name || `#${entry.tournament_id}`}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {sourceUrl ? (
                          <a href={sourceUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                            {tournamentSyncSourceLabel(entry.health.source)}
                          </a>
                        ) : tournamentSyncSourceLabel(entry.health.source)}
                      </TableCell>
                      <TableCell><Badge variant={stateVariant(entry.health.state)}>{t.states[entry.health.state]}</Badge></TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {dateValue(entry.health.lastAttemptAt) ? <DateTime value={dateValue(entry.health.lastAttemptAt)!} locale={locale as Locale} /> : "-"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {dateValue(entry.health.lastSuccessAt) ? <DateTime value={dateValue(entry.health.lastSuccessAt)!} locale={locale as Locale} /> : "-"}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{entry.health.consecutiveFailures}</TableCell>
                      <TableCell>{entry.health.lastFailureCategory ? t.categories[entry.health.lastFailureCategory] : t.categories.none}</TableCell>
                      <TableCell className="text-end tabular-nums">{entry.health.lastItemCount ?? "-"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AdminPageShell>
  );
}
