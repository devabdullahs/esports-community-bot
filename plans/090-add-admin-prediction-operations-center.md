# Plan 090: Add a secure admin prediction operations center

> **Executor instructions**: Web code must never import or instantiate the
> Discord client. Mutations are super-admin-only, same-origin, rate-limited,
> audited, and executed through an idempotent bot-side job/service. Begin with
> failing authorization tests. Stop rather than adding an unaudited shortcut.
>
> **Drift check (run first)**: `git diff --stat 2301227..HEAD -- src/commands/ewc_admin.js src/jobs/ewcPredictions.js src/db/ewcPredictions.js src/db/index.js scripts/postgres/schema.sql apps/web/src/lib/admin.ts apps/web/src/lib/audit.ts apps/web/src/app/admin apps/web/src/app/api/admin apps/web/src/components/admin apps/web/src/lib/admin-navigation.ts`

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plans 082 and 084
- **Category**: direction
- **Planned at**: commit `2301227`, 2026-07-10

## Why this matters

Round generation, snapshots, scoring, reopening, deletion, and diagnosis live
inside a 700-line Discord slash command. Automation failures are primarily log
messages, and the website has no prediction operations page. A super-admin
control center can make incomplete rounds, pending source data, retries, and
recovery actions visible, but it must not duplicate business rules or attempt
to use a Discord client from Next.js. The safe design is a shared command-free
admin service plus a durable, idempotent job queue drained by the bot process.

## Current state

- `src/commands/ewc_admin.js:330-673` directly implements generation,
  snapshotting, manual scoring, reopening, and deletion around DB/scoring calls.
- `src/commands/ewc_admin.js:676-707` provides only an ephemeral text list for
  health/status.
- `src/jobs/ewcPredictions.js:496-528` catches automation errors and logs them;
  no persisted last-attempt/last-error state is available to the dashboard.
- `apps/web/src/app/admin/` has no predictions route.
- Super-only page gates use `getAdminAccess` and redirect, for example
  `apps/web/src/app/admin/analytics/page.tsx:147`.
- Super-only mutation routes combine `sameOriginOr403`, `isSuper`, and
  `recordAdminAudit`; `apps/web/src/app/api/admin/streams/route.ts` is an
  exemplar.
- The bot and web run in one container but are separate runtimes. Shared DB
  state, not in-memory callbacks, is the process boundary.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused bot tests | `node --test tests/ewcPredictionOperations.test.mjs tests/ewcPredictionLifecycle.test.mjs tests/ewcAdminAuditLog.test.mjs` | all pass |
| Focused web tests | `npm --workspace @esports-community-bot/web run test -- src/test/admin-predictions-api.test.ts src/test/admin-authz.test.ts src/test/admin-navigation.test.ts` | all pass |
| Bot suite | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Native typecheck | `npm --workspace @esports-community-bot/web run typecheck:native` | exit 0 |
| Web build | `npm run web:build` | exit 0 |

## Suggested executor toolkit

- Invoke the `shadcn` skill. Use the existing admin Sidebar, PageHeader, Table,
  Badge, AlertDialog, Tabs, and Empty components. Do not create a dashboard of
  decorative nested cards.

## Scope

**In scope**:

- `src/lib/ewcPredictionAdmin.js` (new shared operations service)
- `src/commands/ewc_admin.js` refactored to call it
- `src/jobs/ewcPredictionOperations.js` (new durable job consumer) and startup
  wiring
- `src/db/ewcPredictionOperations.js` (new) plus both schemas
- `apps/web/src/lib/admin-predictions.ts` (new read projection)
- `/admin/predictions` page and focused components
- `/api/admin/predictions/**` read/job routes
- Admin navigation/copy/audit integration
- Focused bot/web tests

**Out of scope**:

- Allowing scoped game/media admins to mutate global prediction state.
- Direct website access to Discord client objects.
- Editing member picks or scores row-by-row.
- New scoring formulas or live Liquipedia request paths.
- Automatic destructive recovery without confirmation.

## Git workflow

- Branch: `advisor/090-admin-prediction-operations`
- Suggested commit: `feat: add admin prediction operations center`
- Do not push or open a PR unless requested.

## Steps

### Step 1: Specify permissions and supported operations

Add authorization tests before routes. The entire page and every API are
super-admin-only in v1. Define a closed operation enum limited to existing
capabilities:

- refresh automation/leaderboard;
- retry scoring one week or season;
- regenerate official weeks with validated timing inputs;
- reopen one scored round and clear its scores;
- delete one week only with exact typed confirmation.

Read-only health may be split out for scoped admins only after a separate
privacy/product decision. Reject arbitrary action names/arguments.

**Verify**: anonymous 401/redirect, scoped admin 403/redirect, super 200; CSRF,
rate-limit, malformed action, and cross-guild tests fail before implementation.

### Step 2: Extract a command-free admin service

Move operation logic from `ewc_admin.js` into `ewcPredictionAdmin.js` with
explicit input/result types-by-tests. It may use existing DB/scoring/Liquipedia
helpers but must receive Discord side effects (announce/leaderboard refresh) as
injected callbacks. Both slash command and job consumer call the same service.

Preserve transaction guards and malformed-pick handling. No operation accepts
member IDs or arbitrary SQL/column names.

**Verify**: existing `/ewc_admin` tests stay behaviorally identical and new
service tests cover each operation without a Discord client.

### Step 3: Add durable operation/health persistence

Add `ewc_prediction_operations` to SQLite and Postgres with fields for id,
guild/season, operation, validated JSON args, status
(`queued/running/succeeded/failed`), idempotency key, requested actor/type/time,
lease/attempt count, started/completed timestamps, and sanitized result/error.
Index queued status and enforce unique idempotency key.

Persist automation attempt/health summaries either in this table as system
operations or a focused health table. Do not store stack traces, tokens, raw
sessions, or unbounded Liquipedia payloads.

**Verify**: schema parity, enqueue dedupe, lease recovery, sanitized failure,
and bounded history tests pass on disposable SQLite and Postgres when available.

### Step 4: Drain jobs in the bot runtime

Create a single-consumer job that atomically leases queued work, calls the
shared service with the live Discord client, records result/failure, and allows
retry after an expired lease. Reuse the existing non-overlap style in
`startEwcPredictions`. Never hold a DB transaction during network calls.

Write both the web admin audit event for enqueue and an execution-completion
event tied to operation ID/actor. Keep Discord audit messages no-ping.

**Verify**: tests cover duplicate enqueue, crash/lease recovery, two consumers,
network failure, success, and audit linkage.

### Step 5: Build the health projection and page

Create a bounded server-side model with:

- season and round effective states;
- game locks and completion counts (no member identities/picks);
- baseline/results/final availability;
- score time/status and participant/scored counts;
- reminder state from plan 084;
- last automation attempt/error and queued/running operations.

Render a dense operational table/tabs for Active, Awaiting results, Scored, and
Operation history. Use status badges, exact/relative times, useful empty states,
and responsive table/card transformations without nested cards.

**Verify**: browser acceptance on mobile/desktop, English/Arabic, long errors,
and no-data/degraded-source states.

### Step 6: Add guarded actions and confirmations

Use explicit dialogs summarizing affected round, participant/score counts, and
irreversibility. Reopen/delete require typing the week key; regeneration shows
the proposed schedule diff before enqueue. Disable duplicate buttons while an
equivalent operation is active. Poll bounded operation status and show result.

**Verify**: route tests prove server-side authorization regardless of hidden UI;
UI model tests prove confirmation payloads cannot target a different round.

### Step 7: Run all gates and failure drills

Run every command. In a disposable DB/test guild, exercise one successful
refresh, one retried failure, one duplicate click, one reopen, and one canceled
delete. Confirm logs/audit/history use the same operation ID.

## Test plan

- Bot service tests for every operation and all transaction guards.
- Queue lease/idempotency tests without real timers/network.
- Web authorization matrix modeled after existing admin tests.
- Pure health/confirmation view-model tests plus browser acceptance.
- Fresh SQLite schema and disposable Postgres parity checks.

## Done criteria

- [ ] Super admins can see actionable prediction health without reading logs.
- [ ] Web actions enqueue durable, idempotent operations; no Discord client is
  imported into web code.
- [ ] Slash command and web jobs use one admin domain service.
- [ ] Every mutation is same-origin, super-only, rate-limited, confirmed, and audited.
- [ ] Failed/abandoned jobs are retryable and never run twice concurrently.
- [ ] All required repo checks pass.

## STOP conditions

- The combined deployment cannot guarantee one bot consumer or safe leases.
- Extracting command logic changes existing score/reopen semantics.
- A requested action cannot be made idempotent or audited.
- The page would need to expose member identities/picks to diagnose round health.

## Maintenance notes

Keep the operation enum closed and require authorization/audit/idempotency tests
for every new action. The web process remains a requester; Discord side effects
belong to the bot consumer.

