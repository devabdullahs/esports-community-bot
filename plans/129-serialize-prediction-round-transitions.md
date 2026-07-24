# Plan 129: Serialize prediction submissions with round transitions and scoring

> **Executor instructions**: Preserve the trusted submission-time behavior from
> plan 082, but close the remaining PostgreSQL race by locking the round before
> member rows and by loading score inputs inside the scoring transaction. Use a
> single documented lock order everywhere. Update the index when complete.
>
> **Drift check (run first)**: `git diff --stat 0718e2d..HEAD -- src/db/ewcPredictions.js src/lib/ewcPredictionWrites.js src/lib/ewcPredictionAdmin.js src/jobs/ewcPredictions.js tests/ewcPredictionWrites.test.mjs tests/ewcPredictionLifecycle.test.mjs tests/ewcPredictionOperations.test.mjs`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/125-add-postgres-ci-coverage.md`
- **Category**: bug
- **Planned at**: commit `0718e2d`, 2026-07-23

## Why this matters

Plan 082 made each member's JSON update atomic, but PostgreSQL submissions still
read the round without locking it. A scorer can close the round and enumerate
predictions while a pre-existing submission later commits, causing that pick to
be omitted or to clear a score. Season duplicate/fill-order checks also occur
before the member row is locked. This plan defines one lock protocol spanning
submission, close, scoring, reopen, and regeneration.

## Current state

- `src/lib/ewcPredictionWrites.js:95-110` re-reads a weekly round inside a
  transaction but calls ordinary `getEwcWeek`; season checks at lines 137-152
  read the member row before `upsertSeasonClubPick` locks it.
- `src/db/ewcPredictions.js:104-111` and `:530` have ordinary round reads.
- Member-row helpers correctly add PostgreSQL `FOR UPDATE` at lines 305-319 and
  578-592. Keep that proven pattern.
- `src/jobs/ewcPredictions.js:535-539` closes a week in a separate write, then
  loads predictions at line 597 before the scoring transaction at line 645.
- Season automation repeats the read-before-transaction sequence at lines
  677-710.
- SQLite transactions use `BEGIN IMMEDIATE`; PostgreSQL transactions use one
  pooled client. SQL must keep `$n` placeholders.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused SQLite tests | `node --test tests/ewcPredictionWrites.test.mjs tests/ewcPredictionLifecycle.test.mjs tests/ewcPredictionOperations.test.mjs tests/ewcPredictionAutomation.test.mjs` | all pass |
| PostgreSQL lane | `npm run test:postgres` | all pass, including new lock races |
| Bot suite | `npm test` | all pass |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web build | `npm run web:build` | exit 0 |

## Scope

**In scope**:

- `src/db/ewcPredictions.js`
- `src/lib/ewcPredictionWrites.js`
- `src/lib/ewcPredictionAdmin.js`
- `src/jobs/ewcPredictions.js`
- `tests/ewcPredictionWrites.test.mjs`
- `tests/ewcPredictionLifecycle.test.mjs`
- `tests/ewcPredictionOperations.test.mjs`
- `tests/ewcPredictionAutomation.test.mjs` (new)
- `tests/postgresDbParity.test.mjs` from plan 125 for PostgreSQL race cases

**Out of scope**:

- New prediction tables or normalizing JSON picks.
- Scoring formulas, result completeness, or event-key migration.
- Network requests inside DB transactions.
- Retrying Discord announcements.

## Git workflow

- Branch: `codex/129-prediction-round-locks`
- Commit style: `fix(predictions): serialize round transitions`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add deterministic race tests

Create tests that pause two operations with barriers rather than sleeps:

- weekly submission starts before closure, closure waits, submission commits,
  and scoring includes it;
- submission starting after closure waits, re-reads `closed`, and is rejected;
- score enumeration cannot occur before an admitted submission commits;
- two concurrent season slot writes cannot persist aliases of the same club or
  bypass fill order;
- reopen/regenerate cannot interleave with scoring.

Run the PostgreSQL variants through plan 125's disposable lane. SQLite variants
must still prove behavior under `BEGIN IMMEDIATE`.

**Verify**: at least the PostgreSQL transition races fail against current code.

### Step 2: Add explicit round-lock helpers

In `src/db/ewcPredictions.js`, add transaction-client-only helpers for week and
season rows with two modes:

- member write: PostgreSQL `FOR KEY SHARE` so concurrent members remain
  possible while status/key-changing updates wait;
- transition: PostgreSQL `FOR UPDATE` for close, score, reopen, regenerate, and
  delete.

SQLite needs no suffix because `BEGIN IMMEDIATE` serializes writers. Reject a
call without a transaction client. Document the universal lock order:

1. week/season round row;
2. member prediction row(s), ordered by stable user ID for batches;
3. reminder/auxiliary rows.

Make list helpers accept an optional transaction client so scoring reads use
the locked transaction snapshot.

**Verify**: focused DB tests confirm generated SQL behavior through real
PostgreSQL, not string-only assertions.

### Step 3: Route member writes through the lock protocol

In each write-service transaction, acquire the round's member-write lock,
recompute the game/status/deadline decision, then lock and mutate the member
row. Move season duplicate-alias and fill-order checks to operate on the locked
member row; compare `clubNameKeys`, not exact display strings.

Refactor the DB layer to expose a narrow locked-row mutation callback or helper
rather than performing an unlocked read followed by a second helper that locks.
Do not hold the transaction while canonicalizing through Liquipedia.

**Verify**: write tests cover aliases, concurrent different slots, first-pick
semantics, and lock boundaries.

### Step 4: Make close and scoring coherent

For automation and admin scoring:

1. close a due/open round in a short transaction under a transition lock;
2. perform external result fetches after that transaction commits;
3. enter a scoring transaction, reacquire the transition lock, revalidate the
   round, load predictions through the transaction client, save every score,
   and mark the round scored in the same commit.

If another worker already closed/scored the round, return an idempotent outcome
instead of scoring twice. Use conditional status updates as defense in depth.
Apply the same protocol to season scoring and reopen.

**Verify**: automation tests prove one final score pass under two concurrent
workers and no admitted pick is omitted.

### Step 5: Run all gates and inspect lock order

Run every command in the table. Review all call paths that update round status
or prediction JSON and confirm they follow the documented order. Use
`git diff --check` and inspect scope.

## Test plan

- Deterministic barriers for submit-versus-close and submit-versus-score.
- PostgreSQL tests for actual row-lock blocking and final state.
- SQLite parity for final behavior.
- Alias-aware season uniqueness inside the locked row.
- Two automation workers produce one scoring transition.

## Done criteria

- [ ] Every prediction write locks the round before the member row.
- [ ] Close/score/reopen/regenerate use a transition lock.
- [ ] Score inputs are read inside the scoring transaction.
- [ ] No network or Discord operation runs while a DB transaction is open.
- [ ] Concurrent submissions cannot be omitted or clear committed scores.
- [ ] SQLite and PostgreSQL focused tests pass.

## STOP conditions

- `FOR KEY SHARE` is incompatible with an actual status update path; report the
  path and choose no weaker lock without review.
- A transaction must span Liquipedia/Discord I/O to achieve correctness.
- Existing callers acquire member rows before round rows and cannot be safely
  reordered within scope.
- PostgreSQL tests cannot reproduce real blocking in the disposable lane.

## Maintenance notes

The lock order is an API contract. Future writers, scorers, reminder claims, or
admin recovery operations must follow it to avoid deadlocks and late writes.

