import { redirect } from "next/navigation";
import { listTournamentOperations } from "@bot/db/tournamentOperations.js";
import { listTournamentSyncHealth } from "@bot/db/tournamentSyncHealth.js";
import { listTournamentRegistry } from "@bot/db/tournaments.js";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { TournamentOperationsCenter } from "@/components/admin/tournament-operations-center";
import { getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { listGames } from "@/lib/games";
import type { Locale } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COPY = {
  en: {
    title: "Tournament operations",
    description:
      "Validate tournament sources, monitor schedule and standings health, and queue lifecycle changes.",
    eyebrow: "Super admin",
  },
  ar: {
    title: "عمليات البطولات",
    description:
      "تحقق من مصادر البطولات وراقب صحة الجداول والترتيب وضع تغييرات دورة الحياة في قائمة التنفيذ.",
    eyebrow: "المسؤول الأعلى",
  },
} as const;

function configuredGuildId() {
  const guildId = String(process.env.DISCORD_GUILD_ID || "").trim();
  return /^\d{1,32}$/.test(guildId) ? guildId : null;
}

function numberOrNull(value: unknown) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export default async function AdminTournamentOperationsPage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/tournaments");
  if (!access.isSuper) redirect("/admin");

  const locale = (await getRequestLocale()) as Locale;
  const guildId = configuredGuildId();
  const registry = guildId ? await listTournamentRegistry({ guildId, limit: 500 }) : [];
  const ids = registry.map((row: { id: number }) => Number(row.id));
  const [healthRows, operations, games] = await Promise.all([
    listTournamentSyncHealth(ids),
    guildId ? listTournamentOperations({ guildId, limit: 100 }) : [],
    listGames(),
  ]);
  const t = COPY[locale];
  const adminCopy = getAdminCopy(locale);

  const tournaments = registry.map((row: Record<string, unknown>) => ({
    id: Number(row.id),
    source: String(row.source || ""),
    externalId: String(row.external_id || ""),
    name: row.name == null ? null : String(row.name),
    effectiveName: String(row.effective_name || row.external_id || `#${row.id}`),
    url: row.url == null ? null : String(row.url),
    game: row.game == null ? null : String(row.game),
    effectiveGame: row.effective_game == null ? null : String(row.effective_game),
    ewc: Boolean(Number(row.ewc || 0)),
    effectiveEwc: Boolean(Number(row.effective_ewc || 0)),
    displayNameOverride:
      row.display_name_override == null ? null : String(row.display_name_override),
    gameOverride: row.game_override == null ? null : String(row.game_override),
    ewcOverride: row.ewc_override == null ? null : Boolean(Number(row.ewc_override)),
    active: Boolean(Number(row.active || 0)),
    archivedAt: numberOrNull(row.archived_at),
    runningCount: Number(row.running_count || 0),
    scheduledCount: Number(row.scheduled_count || 0),
    finishedCount: Number(row.finished_count || 0),
  }));
  const health = healthRows.map((row: Record<string, unknown>) => ({
    tournamentId: Number(row.tournament_id),
    dataKind: String(row.data_kind || "schedule"),
    source: String(row.source || ""),
    supported: row.supported == null ? true : Boolean(Number(row.supported)),
    lastAttemptAt: numberOrNull(row.last_attempt_at),
    lastSuccessAt: numberOrNull(row.last_success_at),
    lastFailureAt: numberOrNull(row.last_failure_at),
    lastFailureCategory:
      row.last_failure_category == null ? null : String(row.last_failure_category),
    consecutiveFailures: Number(row.consecutive_failures || 0),
    lastItemCount: numberOrNull(row.last_item_count),
  }));
  const operationRows = operations.map((operation: Record<string, unknown>) => ({
    id: String(operation.id),
    tournamentId: numberOrNull(operation.tournamentId),
    operation: String(operation.operation || ""),
    source: operation.source == null ? null : String(operation.source),
    sourceId: operation.sourceId == null ? null : String(operation.sourceId),
    game: operation.game == null ? null : String(operation.game),
    status: String(operation.status || ""),
    attempts: Number(operation.attempts || 0),
    requestedAt: String(operation.requestedAt || ""),
    completedAt: operation.completedAt == null ? null : String(operation.completedAt),
    resultCode: operation.resultCode == null ? null : String(operation.resultCode),
    failureCode: operation.failureCode == null ? null : String(operation.failureCode),
    resultTournamentId: numberOrNull(operation.resultTournamentId),
  }));

  return (
    <AdminPageShell
      maxWidth="full"
      breadcrumbs={[
        { label: adminCopy.dashboard.title, href: "/admin" },
        { label: t.title },
      ]}
      eyebrow={t.eyebrow}
      title={t.title}
      description={t.description}
    >
      <TournamentOperationsCenter
        locale={locale}
        configured={Boolean(guildId)}
        tournaments={tournaments}
        health={health}
        operations={operationRows}
        games={games.map((game) => ({
          slug: game.slug,
          label: game.title[locale] || game.title.en || game.slug,
        }))}
      />
    </AdminPageShell>
  );
}
