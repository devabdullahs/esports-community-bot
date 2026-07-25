# Plan 144: Serialize and audit tournament lifecycle operations

> **Executor instructions**: Provider-bound work stays in the bot. The web and
> Discord commands may submit only closed operation names plus bounded source
> identifiers or numeric tournament IDs. Never accept or forward an arbitrary
> URL, host, path, method, or provider request body. Liquipedia access must
> continue through its one serialized queue.
>
> **Drift check (run first)**:
> `git diff --stat d1b66e1..HEAD -- src/commands/add_tournament.js src/commands/remove_tournament.js src/commands/list_tournaments.js src/lib/parseTournamentInput.js src/lib/games.js src/db/tournaments.js src/db/tournamentSyncHealth.js src/db/ewcAdminAuditLog.js src/jobs/morningSync.js src/jobs/standingsSync.js src/jobs/pollingManager.js src/jobs/tournamentScheduleFetch.js src/services/liquipedia apps/web/src/lib/tournaments.ts apps/web/src/app/admin/source-health tests apps/web/src/test`

## Status

- **State**: DONE
- **Priority**: P1
- **Effort**: L
- **Risk**: MED-HIGH
- **Depends on**: 142; 125 recommended; coordinate with 135 and 136
- **Category**: reliability/security
- **Planned at**: commit `d1b66e1`, 2026-07-24

## Why this matters

`/add_tournament` persists an active row and reports success before the first
provider validation. A typo or nonexistent source can become active, and an
arbitrary game override can prevent later canonical game recovery.
`/remove_tournament` flips `active=0` immediately, but already-armed match
watchers do not re-check that lifecycle and can keep fetching/upserting.

The super-admin source-health page can identify a problem but cannot request a
safe retry. Its single health record describes schedule fetches, while the
independent standings job can fail and preserve stale standings without changing
that "Fresh" signal.

The safe operational boundary is a durable, typed queue consumed by the bot:
the web never becomes a second provider client, and user input never becomes an
internal URL path.

## Current state

- `src/commands/add_tournament.js:39-98` stores and announces a tournament
  before detached synchronization verifies it.
- `src/lib/parseTournamentInput.js:76-92` accepts broad source identifiers;
  syntactic recognition does not prove source existence.
- `src/lib/games.js:163-169` has canonical known-game validation that the add
  command does not enforce.
- `src/commands/remove_tournament.js:30-44` deactivates without confirmation.
- `src/db/tournaments.js:219-229` treats archive and deactivate as separate
  operations, but operator UX does not explain the distinction.
- `src/jobs/pollingManager.js:229-261` can continue a watcher after its
  tournament becomes inactive.
- `src/jobs/morningSync.js:44-151` combines reusable immediate sync logic with
  cron lifecycle.
- `src/jobs/standingsSync.js:35-65` logs standings failures but records no
  durable health result.
- `apps/web/src/app/admin/source-health/page.tsx` is super-only and read-only.
- Existing Liquipedia rate rules require all parse/search/LPDB work to remain on
  the serialized/persisted scheduler paths. Plans 135 and 136 strengthen those
  paths and must not be bypassed.

## Security boundary

Allowed queue operations are a closed enum:

```text
validate_and_activate
sync_schedule
sync_standings
archive
deactivate
reactivate
```

All six operations are consumed by the bot. This is required because only that
process can stop or re-arm its in-memory tournament watchers. Archive,
deactivate, and reactivate remain named durable operations, never an arbitrary
queue method or a direct Next.js application-service call.

Inputs are limited to:

- an existing numeric tournament ID; or
- for validation only, a source enum, bounded canonical source ID, and optional
  canonical game slug.

No queue row or API body may contain `url`, `host`, `path`, `method`, headers,
credentials, or provider payload. The bot resolves the provider adapter and
request shape from trusted code.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Parser/operation tests | `node --test tests/parseTournamentInput.test.mjs tests/tournamentSyncHealth.test.mjs tests/matchesStatus.test.mjs` | focused tests pass; no network |
| Bot suite | `npm test` | all pass |
| Admin health tests | `npm --workspace @esports-community-bot/web run test -- admin-source-health tournament-sync-health tournaments-api` | all pass |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Native typecheck | `npm --workspace @esports-community-bot/web run typecheck:native` | exit 0 |
| Web build | `npm run web:build` | exit 0 |
| Lifecycle schema parity | `node --test tests/matchLifecycleSchemaParity.test.mjs` | canonical lifecycle columns/checks agree across backends |
| Queue/fencing DB tests | `node --test tests/tournamentOperationsQueue.test.mjs tests/tournamentOperationsSchemaParity.test.mjs` | lease, idempotency, generation fences, and SQLite/PostgreSQL schema contracts pass |

## Scope

**In scope**:

- Shared tournament application operations outside the jobs layer.
- Exact input parsing and canonical game validation.
- A dual-backend durable operation queue with idempotency and lease recovery.
- Bot-only queue consumption through existing provider schedulers.
- Schedule-versus-standings health.
- Complete deactivate/archive/reactivate semantics and tournament-scoped
  watcher shutdown.
- Discord command adaptation and durable operation attribution.
- Rebase/coordination with plan 142's final lifecycle, polling, and status-test
  contracts before editing shared consumers.

**Out of scope**:

- Direct web access to Liquipedia/start.gg/PandaScore.
- Manual match score/status/standings overrides.
- Arbitrary provider URLs or plugin-like operation dispatch.
- Multi-guild/tenant workflow.
- The admin registry UI; plan 145 consumes these operations.
- Changing provider admission rules owned by plans 135/136.

## Git workflow

- Branch: `codex/144-tournament-operations`
- Commit style: `feat(tournaments): serialize lifecycle operations`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Characterize command and watcher failure seams

Add tests proving the current behavior:

- nonexistent source/game input can be stored before validation;
- sync failure leaves an active row;
- deactivation does not stop/reject a previously armed watcher;
- schedule success plus standings failure still yields one apparently fresh
  health object;
- repeated add/retry requests can schedule duplicate work.

Use injected provider functions and fake clocks. No test may call a provider.

### Step 2: Extract a tournament application service

Move reusable operations out of `src/jobs/morningSync.js` into a focused
application module used by system jobs and the bot queue consumer. Discord/web
handlers submit queue rows rather than calling it cross-process. Provide named
functions with explicit dependencies, for example:

- `validateAndActivateTournament`;
- `syncTournamentSchedule`;
- `syncTournamentStandings`;
- `archiveTournament`;
- `reactivateTournament`;
- `deactivateTournamentCompletely`.

Jobs remain responsible only for cadence/lifecycle. The service resolves
provider adapters from a source enum and calls the existing service facade. It
must not import a web route or accept request-shaped objects.

Preserve current cache invalidation/board refresh behavior after successful
operations.

### Step 3: Harden source and game identity

Replace permissive URL regex behavior with a two-stage parser:

1. validate the raw input against an anchored supported-source grammar before
   constructing `URL`; then
2. parse it, build the one canonical URL for the extracted source/ID, and
   require a strict canonical round-trip match (apart from explicitly listed
   harmless equivalences such as a single trailing slash, if product requires
   one).

This order matters because `URL` can resolve dot segments before application
code inspects the pathname. Raw validation must reject controls, backslashes,
userinfo, ports, query/fragment input, raw `.`/`..` path segments, percent
encodings of `.`, `/`, `\`, or `%`, repeated encoding, and any input whose
parsed serialization changes the security-relevant host/path bytes.

Normalize only supported forms into `{source, sourceId}`. Reject:

- userinfo, ports, fragments, encoded separators, traversal/dot segments;
- host suffix/prefix lookalikes;
- unsupported paths/query-derived identifiers;
- empty/oversized IDs.

Keep explicit non-URL source forms bounded and source-specific. Validate game
against the canonical registry; an omitted game may be resolved from trusted
source data, but an unknown override is an error.

Add a table-driven confusion corpus containing raw and encoded traversal,
double-encoding, alternate separators, mixed-case encodings, userinfo,
lookalike/suffix hosts, ports, query-derived IDs, and normalization-changing
inputs. Every case must fail before provider dispatch.

Parsing proves syntax only. `validateAndActivateTournament` must fetch through
the existing provider path and add/reactivate the row only after an identity
match and a valid schedule/tournament response. A failure remains a failed
request, not an active tournament.

### Step 4: Add the durable closed-operation queue

Add SQLite/PostgreSQL schema and a shared DB module for all six operations.
Requests contain:

- request ID and idempotency key;
- one of the six closed operations;
- existing tournament ID or validation source/source ID/game fields;
- actor type (`discord_admin`, `web_admin`, `system`) and bounded actor ID/name;
- status (`pending`, `running`, `succeeded`, `failed`);
- lease owner/expiry, attempt count, requested/started/completed timestamps;
- bounded result/failure code and resulting tournament ID.

Do not store raw errors or provider responses. Enforce one live request per
idempotency key/operation target. Claim work transactionally on both DBs,
recover expired leases, cap attempts, and make terminal completion idempotent.

Archive/deactivate/reactivate target an existing numeric tournament ID only.
Reactivate never carries source input; the consumer re-reads the stored source
identity and validates it before changing active state.

The queue row is the durable attribution record. A successful web action may
also mirror a bounded event into `ewc_admin_audit_log`, but general audit-log
failure must not erase queue history.

### Step 5: Consume requests only in the bot

Start one consumer with bot lifecycle/shutdown. It dispatches all six closed
operations through the application service. For Liquipedia it must call the same
serialized/persisted scheduler as all other work; never create a second axios
client or direct request path.

Rate-limit/backoff responses should requeue according to the existing scheduler
state, not busy-loop. Queue polling itself may be frequent, but provider
admission remains governed by provider rules.

Provide a safe status projection for the web containing operation, target,
coarse state, timestamps, and bounded failure category only.

For archive/deactivate, the consumer first commits the fail-closed durable state
(`active=0` plus archive semantics where applicable) and increments a durable
`lifecycle_generation`, then stops tournament watchers and refreshes
projections. A plain check of `active` is not sufficient; use the fencing
contract defined in Step 7. If in-memory cleanup fails, the queue request
remains retryable; replay is idempotent and the tournament stays inactive.

For reactivate, the consumer revalidates the stored source through a deliberately
scoped validation admission while the row remains inactive. It increments the
generation and sets active state only after validation succeeds; subsequent
sync/watchers capture the new generation.

### Step 6: Track health per data kind

Evolve the current health model to record at least `schedule` and `standings`
independently. A standings parse that returns no trusted rows while preserving
old data is a failed/degraded standings attempt, not schedule success.

Public projection can show a conservative composite state plus explicitly
named schedule/standings timestamps where the page renders both. Admin
projection may add bounded failure categories and last operation request. Never
store or return raw provider errors.

Add integration tests for:

- schedule success + standings failure;
- standings recovery;
- live-poll embedded standings preservation;
- final tournament health;
- a tournament type with no standings support (not an error).

### Step 7: Make deactivation and archival complete operations

Add tournament identity to watcher records and a tournament-scoped stop
operation. Add a non-secret monotonically increasing
`tournaments.lifecycle_generation` to both schemas. Every watcher/sync captures
`{tournamentId, lifecycleGeneration}`. A read-then-act `active` check is
explicitly insufficient.

Define:

- **Archive**: final public history remains available; no live provider work.
- **Deactivate/hide**: mistaken/invalid source is removed from public active
  discovery; watchers stop; operation is reversible.
- **Reactivate**: source is revalidated/queued before provider work resumes.

These functions are invoked only by the bot queue consumer (system cron may use
the same internal service directly where no external actor is involved). Web
and Discord handlers enqueue the named operation and never attempt to stop
watchers cross-process.

Implement one fencing contract for every side effect:

1. **Provider admission fence**: all schedule/standings/poller dispatches enter
   one per-tournament lifecycle gate. Because the provider scheduler can delay
   a queued request, it must run a `beforeDispatch`-style predicate at actual
   network admission, not only when work is enqueued. Under the lifecycle gate,
   re-read `active=1` and matching generation, then initiate the provider
   request before releasing the gate. If the predicate fails, cancel the queued
   work without a network call.
2. **Persistence fence**: provider results carry the captured generation.
   Apply match/standings changes in a transaction that conditionally locks or
   updates the tournament only when it is still active at that generation
   (`SELECT ... FOR UPDATE`/conditional write in PostgreSQL and the equivalent
   immediate transaction in SQLite). Match writes, transition claims, and any
   notification-outbox rows occur inside that transaction. A stale result is
   discarded and recorded only as a bounded reason code.
3. **Notification/child-watcher fence**: actual Discord send initiation and
   child-watcher registration enter the same lifecycle gate and re-read the
   generation. A transition claim alone is not permission to send after a
   later deactivation. Invoke/send or register before releasing the gate.
4. **Lifecycle fence**: archive/deactivate enters the same gate, commits
   `active=0` and increments generation, then releases the gate and performs
   idempotent watcher cleanup/cache refresh. Once that commit occurs, no new
   provider request, notification, or child watcher may begin. A provider
   request already initiated before the commit may finish, but its generation
   is stale and its result must be discarded.

Reactivate uses the named validation capability while the row remains inactive.
After provider identity validation succeeds, one transaction increments the
generation, sets active, and records the new generation returned to subsequent
sync/watchers.

Add deterministic race tests with controllable barriers:

- pause a watcher after its legacy pre-check but before provider admission,
  commit deactivation, resume it, and prove no network dispatch occurs;
- pause after provider request initiation, commit deactivation, return a result,
  and prove no match/standing write, notification, or child watcher occurs;
- pause after a transition claim but before send/arm, commit deactivation, and
  prove the side effect is fenced;
- crash after inactive-generation commit but before watcher cleanup, replay the
  queue request, and prove cleanup completes without reactivation or duplicate
  audit.

### Step 8: Adapt Discord commands

`/add_tournament` validates syntax/game, enqueues `validate_and_activate`, and
reports a localized pending request ID rather than claiming tracking succeeded.
`/remove_tournament` requires an explicit confirmation naming the tournament
and consequence, then enqueues the complete lifecycle operation. Provide
separate archive/deactivate wording and report the durable request ID.

`/list_tournaments` should not silently cap operator visibility at 25; add
pagination or a bounded summary with an explicit total and next action.

Keep Discord server-side permission declarations. Durable operation rows record
the acting Discord ID and bounded display name; no secret or request body is
stored.

### Step 9: Run all gates

Run focused bot/admin tests, full bot and web suites, lint, native typecheck,
build, and schema parity. With plan 125 available, run lease/idempotency tests
against PostgreSQL. Confirm tests cannot resolve provider hosts.

## Test plan

- Exact-host/path parser corpus including encoded traversal/confusion cases.
- Unknown game and nonexistent source do not activate a row.
- All six queue operations: idempotency, claim race, lease recovery, retry cap,
  crash between durable state and watcher cleanup, and shutdown.
- Provider admission remains serialized.
- Schedule and standings health can disagree truthfully.
- Generation-fenced races at provider admission, result write, notification,
  and child-watcher registration.
- Archive/deactivate/reactivate semantics.
- Discord confirmation, pending, failure, and paginated list behavior.
- SQLite/PostgreSQL schema and transaction parity.

## Done criteria

- [ ] A tournament becomes active only after trusted provider validation.
- [ ] Unknown game/source input cannot poison the active registry.
- [ ] Web/commands submit only closed, bounded operations.
- [ ] Provider work remains bot-only and serialized.
- [ ] Schedule and standings freshness are distinguishable.
- [ ] After inactive-generation commit, no new fetch/notify/child watcher starts
  and all already-started provider results are discarded.
- [ ] Archive/deactivate/reactivate run in the bot consumer; reactivation
  validates while inactive.
- [ ] Every request has durable actor/status attribution.
- [ ] Queue behavior is idempotent and lease-recoverable.
- [ ] All repository gates pass.

## STOP conditions

- An implementation needs to place a raw URL/path/method in a queue row.
- A provider adapter would bypass plans 135/136 or the Liquipedia serialized
  queue.
- A lifecycle operation cannot prevent an in-flight watcher from writing after
  deactivation.
- Cross-backend lease/uniqueness semantics cannot be made equivalent.
- Production queue/reconciliation apply is requested without a dry run and
  separate operator approval.

## Maintenance notes

Adding an operation requires a code enum, authorization policy, idempotency
definition, bounded audit/result fields, consumer test, and admin/command copy.
Unknown operation strings always fail closed.
