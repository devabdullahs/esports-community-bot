# Plan 100: Show tournament data freshness and source health

> **Executor instructions**: Follow each step and verification. Public health
> output must be a coarse status, timestamp, and source label only. Never expose
> upstream response bodies, credentials, stack traces, internal URLs, or raw
> error messages. The reviewer owns roadmap status.
>
> **Mandatory dependency gate (before drift check)**: Plan 094 must have an
> approved review verdict and be present in the execution worktree. Verify
> `32b2782817462c7487d1750108ba289025e076ee` is an ancestor of `HEAD` only
> after creating the isolated worktree. Stop if unavailable; do not create a
> second E2E baseline.
>
> **Drift check (run second)**: Plan 094's approved files are execution
> baseline, not drift. Run `git diff --stat
> 32b2782817462c7487d1750108ba289025e076ee..HEAD --
> src/jobs/pollingManager.js src/jobs/morningSync.js src/db/index.js
> scripts/postgres/schema.sql apps/web/src/lib/tournaments.ts
> apps/web/src/app/api/tournaments apps/web/src/app/tournaments/[id]/page.tsx
> apps/web/src/components/tournaments/tournament-match-list.tsx
> apps/web/src/lib/public-mcp-tools.ts apps/web/src/lib/ewc-clubs.ts
> apps/web/src/lib/i18n.ts`. Stop if schedule fetch ownership or tournament
> public projections changed unexpectedly beyond that approved baseline.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED-HIGH
- **Depends on**: Plan 094; Plan 095 recommended
- **Category**: direction / observability / migration
- **Planned at**: commit `1530ee8`, 2026-07-14

## Why this matters

Tournament pages identify Liquipedia/start.gg/PandaScore but do not tell users
when the last successful sync happened or whether displayed scores are delayed.
The poller keeps failures only in logs and in-memory maps, so users interpret a
stale score as an authoritative current score and admins cannot quickly
distinguish source delay from parser/database failure. Durable, sanitized sync
health makes uncertainty explicit without leaking operational details.

## Current state

- `src/jobs/pollingManager.js` owns an in-memory `tournamentPolls` promise map.
  `fetchTournamentSchedule()` calls `service.fetchSchedule(tournament)` and
  deletes the promise on completion. Poll errors are logged only.
- `src/jobs/morningSync.js` calls `service.fetchSchedule(t)` independently, so
  health cannot be complete if only the live poller is instrumented.
- `apps/web/src/lib/tournaments.ts` returns safe tournament/match/standings
  projections but no sync metadata. The public API and MCP build on these
  helpers.
- `apps/web/src/app/tournaments/[id]/page.tsx` displays a source badge and source
  link. `TournamentMatchList` polls the public endpoint every 90 seconds but
  gives no last-success/stale feedback.
- `apps/web/src/lib/ewc-clubs.ts` is the exemplar for a public coarse contract:
  `updatedAt`, `dataSource`, `stale`, and a safe warning. Reuse the concept, not
  its exact six-hour threshold.
- SQLite schema is `src/db/index.js`; Postgres schema is
  `scripts/postgres/schema.sql`; shared queries use `$1` placeholders.

## Public status model

Expose only:

```ts
type PublicSyncHealth = {
  state: "fresh" | "delayed" | "unavailable" | "final";
  lastSuccessAt: number | null;
  source: "liquipedia" | "startgg" | "pandascore";
};
```

Derive status server-side:

- archived/final tournament with at least one successful sync: `final`;
- tournament with a running match: calculate `freshWindow = max(2 * configured
  poll interval, 5 minutes)` and `unavailableAfter = max(30 minutes,
  2 * freshWindow)`; fresh through `freshWindow`, delayed through
  `unavailableAfter`, then unavailable. The pure classifier must enforce
  `freshWindow < unavailableAfter` even for a large configured interval;
- active tournament without a running match: fresh through 30 hours, delayed
  through 48 hours, then unavailable;
- never-successful or three consecutive failures: unavailable (unless a recent
  success is still inside the fresh window; then delayed, not fresh).

Store timestamps and failure category, then centralize these thresholds in one
pure function. Do not infer freshness from `matches.updated_at`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused bot tests | `node --test tests/tournamentSyncHealth.test.mjs tests/pollingManager.test.mjs` | all pass |
| Focused web tests | `npm --workspace @esports-community-bot/web run test -- tournament-sync-health tournaments-api public-mcp-api` | all pass |
| Bot tests | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Native typecheck | `npm --workspace @esports-community-bot/web run typecheck:native` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| E2E | `npm run web:e2e` | freshness states pass |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- `src/db/index.js`
- `scripts/postgres/schema.sql`
- `src/db/tournamentSyncHealth.js` (create)
- `src/jobs/tournamentScheduleFetch.js` (create)
- `src/jobs/pollingManager.js`
- `src/jobs/morningSync.js`
- `src/lib/tournamentSyncHealth.js` (create; pure classifier/error category)
- `apps/web/src/lib/tournaments.ts`
- `apps/web/src/app/api/tournaments/route.ts`
- `apps/web/src/app/api/tournaments/[id]/matches/route.ts`
- `apps/web/src/app/tournaments/[id]/page.tsx`
- `apps/web/src/components/tournaments/tournament-match-list.tsx`
- `apps/web/src/lib/public-mcp-tools.ts` safe fields only
- `apps/web/src/app/admin/source-health/page.tsx` (create) and admin navigation
- `apps/web/src/lib/i18n.ts`
- related bot/web tests

**Out of scope**:
- Changing provider request rate, retry, backoff, parsing, or cache policy.
- Exposing raw error text or a public uptime history.
- A general infrastructure status page.
- Auto-switching tournament sources.
- A new public issue/report database or anonymous write endpoint.

## Git workflow

- Work only in a separate worktree (or clean clone) based on a branch that
  contains approved Plan 094 work, on `codex/100-tournament-source-health`.
  Never commit from the dirty operator checkout and never use `git clean`,
  `git stash`, reset, or checkout there.
- Commit logical units: schema/model, fetch integration, public/admin UI.
- Example: `feat(tournaments): expose safe sync freshness`.

## Steps

### Step 1: Add the durable health table on both backends

Create `tournament_sync_health` keyed by `tournament_id` with FK cascade,
source, `last_attempt_at`, `last_success_at`, `last_failure_at`, sanitized
`last_failure_category`, `consecutive_failures`, `last_item_count`, and
`updated_at`. Categories are a closed set: `rate_limit`, `auth`, `timeout`,
`network`, `parse`, `unknown`. No message/body/URL column. Add source and
last-success indexes useful for admin sorting.

Implement atomic success/failure upserts. Success resets failure count/category
and records item count; failure increments count without clearing the previous
success. Accept injected timestamps for tests.

Use the repository's additive schema mechanism explicitly: append idempotent
`CREATE TABLE IF NOT EXISTS` plus indexes to `src/db/index.js` so existing
SQLite databases gain the table on startup, and append the equivalent schema to
`scripts/postgres/schema.sql` so `ensurePostgresAppSchema` applies it to
existing Postgres deployments. Do not require a manual destructive migration.

**Verify**: tests cover first success, repeated failure, recovery, concurrent
upsert behavior, FK deletion, and SQLite/Postgres schema parity. Initialize a
temporary database from the pre-plan schema, load the schema module, and prove
the existing data remains while the health table and upsert helpers work.

### Step 2: Centralize schedule fetching and health recording

Move the cross-caller in-flight promise map into
`src/jobs/tournamentScheduleFetch.js`. Export a function receiving the service,
tournament, and optional clock. It records attempt, calls the existing
`service.fetchSchedule` once per tournament, validates the returned value is an
array, records success/count, or categorizes and records failure before
rethrowing the original error. Its `finally` clears the in-flight map.

Use this function from both `pollingManager.js` and `morningSync.js`. Preserve
all existing rate/backoff behavior and do not wrap detail-page fetches.

**Verify**: tests prove concurrent morning/live calls share one provider
promise, success/failure records once, rejection reaches both callers, and a
later call can retry after cleanup.

### Step 3: Define and test the coarse public classifier

Create a pure classifier implementing the Product status model above. Inputs
are health row, active/archived status, running-match boolean, configured poll
interval, and `nowSec`. Clamp invalid poll intervals and future timestamps.
Return no failure category/message. Add safe source-label mapping and a separate
admin projection that may include category/failure count, still never raw text.

**Verify**: table-driven tests cover every boundary, a configured poll interval
larger than 15 minutes, never-successful, future clock skew, three failures
with recent success, archived final, and invalid input.

### Step 4: Add health to public tournament projections

Batch-load health rows for tournament directories to avoid N+1. Add
`syncHealth` to tournament summaries and detail response. Update the API cache
key/tag or revalidation so a health write becomes visible within the existing
poll interval; do not disable all caching. Include the same coarse object in
public MCP `list_tournaments` and `get_tournament_status` only.

**Verify**: API/MCP tests assert the exact four-field safe shape, no failure
category/raw error, correct state boundaries, and bounded query count.

### Step 5: Show freshness where users interpret live data

On tournament detail, place a compact status row near the source badge:

- Fresh / Updated locally formatted time;
- Delayed / Last successful update;
- Source unavailable / Last known update;
- Final data / Stored final snapshot.

Use existing Badge/Tooltip/Alert components, `LocalDateTime`, logical alignment,
and EN/AR copy. In delayed/unavailable state, explain that displayed data may
lag and keep the official source button visible. Add a "Report data issue"
button that opens the existing public contact email or Discord contact path
with only tournament ID/source label in the prefilled subject; do not submit a
new anonymous API request. Update live polling responses in-place without page
reload.

**Verify**: component/E2E tests cover all states, local time, mobile, RTL, and
state update after a polled response.

### Step 6: Add a super-admin source-health view

Create `/admin/source-health` using the existing admin layout/guard and sidebar.
Show active tournaments sorted unavailable/delayed/fresh, source, last attempt,
last success, consecutive failures, safe category, item count, and link to the
tournament/source. Add filters by source/state. Do not add a manual refresh
button in v1 because it could bypass provider scheduling/rate limits.

**Verify**: admin auth matrix covers signed out/scoped/super access according to
the existing policy, and rendered output contains no raw errors or secrets.

### Step 7: Full verification and failure simulation

Run all commands. In disposable tests simulate timeout, rate limit, parse
failure, and recovery without network access. Confirm provider client files and
Liquipedia rate settings are unchanged. Run `git diff --check`.

## Test plan

- `tests/tournamentSyncHealth.test.mjs`: DB upserts, classifier, central fetch
  concurrency, categories, recovery.
- Extend polling/morning tests with injected fake services only.
- Web API/MCP tests for safe projection and batched directory load.
- Component/E2E tests for every public state in EN/AR and admin sorting/auth.
- Negative assertion recursively rejects keys matching
  `error|message|stack|credential|token|responseBody` in public health JSON.

## Done criteria

- [ ] Every schedule fetch from morning/live paths records durable health once.
- [ ] Public output contains only state, last success, and source (plus no raw
      operational detail).
- [ ] Directory health loads are batched and cached for no longer than the
      existing polling visibility window.
- [ ] Tournament pages show truthful local-time freshness and issue handoff.
- [ ] Admin view shows sanitized operational categories without triggering
      provider fetches.
- [ ] Provider rate/backoff/client code is unchanged.
- [ ] Dual-backend and all repository gates pass.

## STOP conditions

- Instrumentation requires a second/parallel provider request path.
- An upstream caller intentionally treats a non-array schedule as success.
- Public UI requirements demand raw error messages or internal response data.
- Cache invalidation would require making all tournament pages uncached.
- A manual admin refresh cannot be implemented without violating provider rate
  serialization (leave it out and report).

## Maintenance notes

This is source-data health, not whole-site uptime. Add new providers to the
closed source/category mappings and tests. Reviewers should verify all schedule
callers use the central wrapper, public projections remain coarse, and health
writes never alter fetch timing or swallow original errors.
