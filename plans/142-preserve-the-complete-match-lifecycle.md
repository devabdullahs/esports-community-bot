# Plan 142: Preserve the complete match lifecycle and outcome

> **Executor instructions**: Treat provider values as inputs to one canonical
> domain model. Do not add provider-specific states directly to page
> components, and do not infer a scoreless winner from scores that are absent.
> All provider tests must use fixtures or injected clients.
>
> **Drift check (run first)**:
> `git diff --stat d1b66e1..HEAD -- src/db/index.js scripts/postgres/schema.sql src/db/matches.js src/services/pandascore.js src/services/startgg.js src/services/liquipedia src/jobs apps/web/src/lib/tournaments.ts apps/web/src/lib/match-details.ts apps/web/src/components/tournaments apps/web/src/components/matches tests apps/web/src/test`

## Status

- **State**: DONE
- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: 125 recommended for PostgreSQL verification
- **Category**: bug
- **Planned at**: commit `d1b66e1`, 2026-07-24

## Why this matters

The stored match model can represent only scheduled, running, and finished.
PandaScore maps every other upstream status to scheduled, so postponed or
cancelled matches can keep appearing as upcoming. Liquipedia can parse a winner
from a scoreless decision, but the database drops that winner; public surfaces
then show only a generic "Finished."

This is not limited to one page. Status and outcome drive tournament rows,
brackets, match headers, live-center history, polling, reminders, and
notifications. Fixing the label only in React would leave those consumers
contradicting each other.

## Current state

- `src/db/index.js:34-35` constrains match status to `scheduled`, `running`, or
  `finished`; the PostgreSQL schema mirrors the same domain.
- `src/services/pandascore.js:123-130` collapses every state other than exact
  running/finished to scheduled.
- `src/services/liquipedia/parsers.js:440-474` captures a winner class even
  when a final has no numeric score.
- `src/db/matches.js:68-86` does not persist the parsed winner.
- `apps/web/src/components/tournaments/tournament-match-list.tsx:141-170`
  infers a winner only from numeric scores.
- Polling/reminder/notification code assumes the three-state lifecycle.
- Existing aliases/deduplication must continue producing one canonical match
  across source rows.

## Canonical target model

Use one small provider-neutral model. Exact names may adapt to repository
conventions, but the semantics must remain:

```ts
type MatchStatus =
  | "scheduled"
  | "running"
  | "finished"
  | "postponed"
  | "cancelled";

type WinnerSide = "team1" | "team2" | "draw" | null;

type ResultReason =
  | "normal"
  | "walkover"
  | "forfeit"
  | "cancelled"
  | "postponed"
  | "unknown";
```

`winnerSide` is independent of numeric scores. Do not persist unbounded raw
provider status/reason text. If a provider state cannot be mapped with
confidence, log a bounded code and preserve the previous known state rather
than inventing `scheduled`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Provider/parser fixtures | `node --test tests/liquipediaParsers.test.mjs tests/pandascoreProfiles.test.mjs tests/startgg.test.mjs` | focused provider tests pass; no network |
| Match DB tests | `node --test tests/matchesStatus.test.mjs tests/matchReminders.test.mjs tests/matchMessage.test.mjs` | lifecycle round trips and consumers pass on SQLite |
| Web lifecycle tests | `npm --workspace @esports-community-bot/web run test -- tournaments-api match-details-model live-match-center bracket-view` | all pass |
| Bot suite | `npm test` | all pass |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Native typecheck | `npm --workspace @esports-community-bot/web run typecheck:native` | exit 0 |
| Web build | `npm run web:build` | exit 0 |
| Lifecycle schema parity | `node --test tests/matchLifecycleSchemaParity.test.mjs` | SQLite and PostgreSQL lifecycle columns/checks agree |

## Scope

**In scope**:

- Canonical status/winner/reason normalization.
- SQLite and PostgreSQL schema/migration parity.
- Match inserts/upserts, dedupe, and public projections.
- Poller, notification, and reminder transition semantics.
- Tournament, bracket, live-center, and match-page display.
- Historical backfill limited to evidence already stored.

**Out of scope**:

- Manual score/status overrides.
- Adding a new provider.
- Guessing cancelled/postponed outcomes from missing schedules.
- Fetching historical source pages during migration.
- Changing tournament finality or EWC scoring; plan 131 owns final evidence.

**Coordination gate**:

- Plan 144 must rebase on this plan after the canonical status/outcome model,
  `pollingManager` transitions, schema, and status tests are final. Do not merge
  independent edits to those shared consumers. Plan 144 owns durable operator
  requests and tournament-scoped watcher shutdown; this plan owns what each
  match lifecycle state means.

## Git workflow

- Branch: `codex/142-complete-match-lifecycle`
- Commit style: `fix(matches): preserve lifecycle and outcome`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Characterize all current state consumers

Create a checked inventory of every status comparison and transition consumer:

- provider normalizers/parsers;
- DB checks/upserts/read helpers;
- morning sync and live polling;
- Discord start/result notifications;
- match reminders and calendar projection;
- tournament directory/detail/bracket;
- `/live` and `/matches/[id]`.

Add pure transition tests before editing production behavior. At minimum cover:

- scheduled -> postponed -> scheduled -> running -> finished;
- scheduled/running -> cancelled;
- running -> finished with score;
- scheduled -> finished with winner but no score;
- duplicate provider rows disagreeing on status/outcome.

Define precedence and timestamp rules explicitly. A stale provider row must not
move a finished/cancelled match backward.

### Step 2: Add dual-schema lifecycle fields

Add status values and nullable bounded outcome columns to both schemas and
their migration paths. Prefer side-relative winner storage because team names
are already projected on the match row. Add checks for known enum values.

Backfill only what can be proven:

- infer winner side when stored scores differ;
- keep tied or scoreless finished rows with `winner_side = NULL`;
- do not rewrite any scheduled row as postponed/cancelled without evidence;
- use `normal` only for score-decided finals, otherwise `unknown`.

Create `tests/matchLifecycleSchemaParity.test.mjs` to inspect both current
schema definitions and fail when status/outcome columns or constraints drift.
Update import tests as needed. Plan 133 may later move DDL into versioned
migrations; this plan must still keep both current backends aligned.

**Verify**: SQLite round trips and PostgreSQL CI (when plan 125 is available)
preserve every state/outcome value.

### Step 3: Centralize provider normalization

Create one pure match lifecycle normalizer used by all providers. Each adapter
maps only documented values into the canonical input:

- explicit cancelled/abandoned values -> cancelled;
- explicit postponed/delayed values -> postponed;
- explicit completed values -> finished;
- explicit live values -> running;
- explicit not-started values -> scheduled.

Unknown values return an `unknown_status` outcome that does not overwrite the
last trusted stored state. Preserve source winner evidence separately from
scores. Never call axios or a provider directly from the normalizer.

Add fixture tests for real sanitized provider payload shapes, including
scoreless winner classes and PandaScore postponed/cancelled values.

### Step 4: Make persistence merge status and outcome coherently

Update match upserts/deduplication so one transaction chooses:

- the newest/strongest trusted lifecycle state;
- explicit winner evidence over score inference;
- score inference only when numeric scores decisively differ;
- no winner for cancellation/postponement;
- no backward transition from terminal state without a documented correction
  rule.

If providers disagree, emit bounded structured diagnostics with tournament and
match IDs but no raw payloads. Keep alias matching behavior stable.

**Verify**: dual-source fixtures cannot create two public matches or erase a
trusted winner with a weaker update.

### Step 5: Define polling, reminders, and notification transitions

Adjust consumers deliberately:

- cancelled matches stop watchers and cancel pending reminders;
- postponed matches stop imminent/start notifications, retain eligible
  reminders only after a new start time is published, and may be polled at a
  conservative recovery cadence;
- scoreless finals can send a result with the explicit winner/reason;
- a transition back to scheduled is allowed only from postponed with newer
  source evidence;
- duplicate terminal updates remain idempotent.

Do not change Liquipedia admission/rate behavior. Every request continues
through the existing serialized queue.

### Step 6: Project states consistently to every public surface

Create one public status/outcome formatter consumed by tournament rows, bracket
cards, `/live`, and match header. It must:

- localize postponed/cancelled/result reason in EN/AR;
- emphasize an explicit winner even when both scores are absent;
- avoid rendering cancelled/postponed as destructive system errors;
- keep semantic text available when color is absent;
- use the shared competition primitives introduced by plan 141 when present,
  without requiring that plan to land first.

Do not make page components interpret provider fields.

### Step 7: Reconcile historical rows safely

Provide a dry-run script that reports aggregate counts of:

- score-inferable winners;
- scoreless/unknown finals;
- rows that cannot be upgraded;
- invalid legacy status/outcome combinations.

The default mode is report-only against a disposable DB. Any production apply
is a separate operator-approved action. No reconciliation may access provider
networks.

### Step 8: Run all gates

Run provider fixtures, DB/status tests, full bot suite, web focused/full tests,
lint, native typecheck, build, and schema parity. If plan 125 is available, run
the PostgreSQL lane before merge.

## Test plan

- Pure lifecycle transition matrix.
- Provider normalization fixtures for every known state.
- SQLite/PostgreSQL schema and round-trip parity.
- Alias/dedupe conflicts and idempotent terminal updates.
- Cancelled/postponed reminder and notification behavior.
- Scoreless explicit-winner result on tournament, bracket, live, and match
  views.
- EN/AR status/reason copy and non-color semantics.
- Dry-run reconciliation with no network.

## Done criteria

- [x] Cancelled and postponed matches are not shown as upcoming.
- [x] A trusted scoreless winner survives parsing, persistence, and projection.
- [x] Unknown provider states do not overwrite a trusted state.
- [x] Polling, reminders, notifications, and pages share one transition model.
- [x] SQLite and PostgreSQL remain schema-compatible.
- [x] Historical changes are evidence-based and dry-run-first.
- [x] No tests access providers.
- [x] All repository gates pass.

## Verification evidence

- `npm test`: 813 tests, 797 passed, 16 skipped, 0 failed.
- `npm --workspace @esports-community-bot/web run lint`: passed.
- `npm --workspace @esports-community-bot/web run typecheck:native`: passed.
- `npm --workspace @esports-community-bot/web run test`: 127 files and
  1,275 tests passed.
- `npm run web:build`: passed with Next.js 16.2.7.
- `npm run db:pg:schema:check`: generated PostgreSQL schema is current.
- Lifecycle provider, persistence, reconciliation, schema-parity, reminder,
  polling, bracket, and localization tests passed without provider network
  access.
- The destructive PostgreSQL reset lane was not run locally because
  `ALLOW_POSTGRES_TEST_RESET=1` was not available. PostgreSQL migration and
  round-trip tests are registered for the isolated CI lane; static schema
  parity passed locally.

## STOP conditions

- A provider's state semantics are undocumented or ambiguous. Capture a
  sanitized fixture and leave the previous trusted state unchanged.
- Supporting a transition would resend a notification or reminder without an
  idempotency proof.
- A migration would infer cancellation/postponement from absence of data.
- SQLite and PostgreSQL cannot express the same constraint safely.

## Maintenance notes

New providers must map into the canonical model and pass the transition matrix.
Do not add provider-specific status branches to React components or jobs.
