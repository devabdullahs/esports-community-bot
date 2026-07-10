# Plan 082: Make prediction writes atomic and deadline-safe

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update this plan's row in
> `plans/README.md` unless a reviewer says they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2301227..HEAD -- src/commands/ewc_predict.js src/db/ewcPredictions.js src/lib/ewcPredictions.js src/lib/ewcGameTeams.js src/lib/ewcClubCache.js src/db/client.js tests/ewcPredictionLifecycle.test.mjs tests/ewcPredictionScoring.test.mjs`
> If any in-scope file changed, compare the current-state excerpts below with
> live code. Stop on a semantic mismatch.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `2301227`, 2026-07-10

## Why this matters

Weekly and season picks are currently check-then-act operations. A Discord
interaction checks the deadline, performs participant/club resolution, and
then writes without revalidating the round; a cold Liquipedia-backed club-cache
resolution can therefore cross the lock time. Incremental picks also read the
whole JSON array, modify it in memory, and replace it, so two simultaneous
mobile/desktop submissions can lose one another. This plan creates one trusted
write service that both Discord and future web submission can use.

## Current state

- `src/commands/ewc_predict.js:735-766` checks `gameClosedMessage`, then awaits
  participant/club resolution, then calls `upsertWeeklyGamePick`.
- `src/commands/ewc_predict.js:877-938` has the same gap for season slots.
- `src/db/ewcPredictions.js:214-232` implements weekly incremental writes as:

```js
const existing = await getWeeklyPrediction(guildId, weekId, userId);
const current = Array.isArray(existing?.picks) ? existing.picks : [];
// ...merge in memory...
const result = await upsertWeeklyPrediction({ guildId, weekId, userId, picks: next });
```

- `src/db/ewcPredictions.js:390-406` repeats this read-modify-write pattern for
  season slots and swaps.
- `src/lib/ewcPredictions.js:203-213` drops `pickedAt` while normalizing weekly
  picks, and `scorePerGameWeeklyPrediction` consequently accepts any stored
  pick regardless of when it was written.
- `src/db/client.js:161-191` is the transaction exemplar. SQLite transactions
  are serialized and use `BEGIN IMMEDIATE`; Postgres receives one pooled client.
- The app supports both better-sqlite3 and Postgres. SQL must continue using
  `$1` placeholders so the SQLite adapter can translate it.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused bot tests | `node --test tests/ewcPredictionWrites.test.mjs tests/ewcPredictionLifecycle.test.mjs tests/ewcPredictionScoring.test.mjs tests/ewcPickerEntry.test.mjs` | all pass |
| Bot suite | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

## Scope

**In scope**:

- `src/lib/ewcPredictionWrites.js` (new command-free domain service)
- `src/commands/ewc_predict.js`
- `src/db/ewcPredictions.js`
- `src/lib/ewcPredictions.js`
- `tests/ewcPredictionWrites.test.mjs` (new)
- Focused updates to `tests/ewcPredictionLifecycle.test.mjs` and
  `tests/ewcPredictionScoring.test.mjs`

**Out of scope**:

- Website pick forms or API routes; plan 088 owns those.
- Scoring formulas and point values.
- Liquipedia queue/rate settings or new network paths.
- Schema normalization into one row per game pick.
- Admin scoring commands unrelated to member submission.

## Git workflow

- Branch: `advisor/082-atomic-prediction-writes`
- Use conventional commits, for example
  `fix: make prediction submissions atomic`.
- Do not push or open a PR unless the operator requests it.

## Steps

### Step 1: Add failing boundary and concurrency tests

Create `tests/ewcPredictionWrites.test.mjs` using the disposable SQLite setup in
`tests/ewcPredictionLifecycle.test.mjs`. Cover:

- two concurrent weekly submissions for different game keys preserve both;
- two concurrent first picks produce exactly one `firstPick: true` result;
- replacing one game preserves every other game;
- a trusted submission timestamp before `lockAt` remains valid even if name
  resolution completes afterward;
- a timestamp at or after `lockAt` is rejected without changing stored picks;
- season slot updates and swaps do not lose concurrent changes;
- scored/closed rounds reject writes;
- a stored weekly pick whose explicit `pickedAt` is after `lockAt` cannot score,
  while legacy picks without `pickedAt` remain backward-compatible.

Use barriers/promises so concurrency tests overlap deterministically; do not
use arbitrary sleeps.

**Verify**: run the focused test command. New regression tests must fail against
the old implementation for the expected reasons.

### Step 2: Make DB mutations transaction-aware

Extend the relevant DB helpers to accept an optional transaction client, as the
score-saving helpers already do. Add a private transaction path that:

1. ensures the prediction row exists with `INSERT ... ON CONFLICT DO NOTHING`;
2. locks/serializes that member's row before reading it (`SELECT ... FOR UPDATE`
   on Postgres; the existing `BEGIN IMMEDIATE` serialization is sufficient on
   SQLite);
3. merges one game or season slot;
4. updates score/details to `NULL` and returns whether the row previously had
   zero picks.

Use `dbDriver()` only at the narrow SQL-lock boundary. Never interpolate user
data or column names. Keep `$n` placeholders and pass every value separately.

**Verify**: focused lifecycle/write tests pass repeatedly with
`node --test --test-reporter=spec ...`.

### Step 3: Create the trusted prediction-write service

Add `src/lib/ewcPredictionWrites.js`. It should expose weekly game, season slot,
and season swap operations that accept a server-derived `submittedAt` and:

- load the current round/game;
- validate status, open time, and the relevant game/season lock against
  `submittedAt`;
- resolve/canonicalize the raw club outside the transaction using the existing
  participant-first and `resolveEwcClubPick` behavior;
- enter the short DB transaction, re-read the round/configuration, ensure the
  same game still exists, and perform the atomic mutation;
- return typed result codes/messages suitable for Discord and future web routes.

Do not hold a DB transaction open while waiting on Liquipedia or Discord.

**Verify**: focused tests prove lock-boundary behavior without network calls.

### Step 4: Route every Discord mutation through the service

In `src/commands/ewc_predict.js`, capture trusted submission time immediately
from `interaction.createdTimestamp` (fall back to handler-entry `Date.now()`
only in tests/mocks). Replace direct calls to incremental DB helpers with the
new service. Keep the current ephemeral picker, owner checks, public
participation announcement, and error wording behavior.

The service result, not a preflight read, must decide `firstPick`; this prevents
duplicate participation announcements under races.

**Verify**: `tests/ewcPickerEntry.test.mjs` and the new write tests pass.

### Step 5: Add scoring defense in depth

Preserve `pickedAt` in normalized per-game picks. If a stored pick has an
explicit `pickedAt > game.lockAt`, represent it as a rejected/late pick worth
zero and include that fact in score details. Do not reject legacy rows that do
not have `pickedAt`; changing their historical scores would be a migration.

**Verify**: scoring tests cover before, exactly-at, after, and legacy timestamps.

### Step 6: Run all gates and inspect scope

Run every command in the command table. Confirm `git diff --name-only` contains
only in-scope source/tests plus the plan status update.

## Test plan

- Model DB setup after `tests/ewcPredictionLifecycle.test.mjs`.
- Model scoring assertions after `tests/ewcPredictionScoring.test.mjs`.
- No test may call Liquipedia; inject resolvers or use cached fixture values.
- If a disposable Postgres URL is available, run the new write tests once with
  `DB_DRIVER=postgres` against a disposable database. Never use production data.

## Done criteria

- [ ] Concurrent weekly and season edits cannot lose data.
- [ ] Exactly one concurrent first pick reports `firstPick: true`.
- [ ] Lock decisions use trusted request time and are revalidated before commit.
- [ ] No network request occurs inside a DB transaction.
- [ ] Explicitly late stored picks cannot score; legacy rows remain compatible.
- [ ] All required repo checks pass.
- [ ] No website pick API was added.

## STOP conditions

- The only feasible approach requires a Postgres-only JSON operation with no
  SQLite equivalent.
- Discord interaction creation time is unavailable or untrustworthy in the
  installed discord.js version.
- Atomicity appears to require holding a transaction across Liquipedia access.
- Existing production picks contain explicit `pickedAt` values after lock and
  changing their scoring would alter an already-published leaderboard; report
  the rows/count only, without member IDs.

## Maintenance notes

All future prediction writers, including plan 088's web routes, must call this
service rather than DB helpers directly. Reviewers should scrutinize lock-time
semantics, transaction duration, and parity between SQLite and Postgres.

