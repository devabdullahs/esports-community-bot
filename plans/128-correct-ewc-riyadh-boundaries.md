# Plan 128: Compute and reconcile official EWC boundaries in Riyadh

> **Executor instructions**: Fix both future generation and already stored 2026
> rounds. The reconciliation must be dry-run by default. If any stored pick was
> submitted inside a newly invalid one-hour window, STOP and report aggregate
> counts without member identifiers; do not silently change published scoring.
>
> **Drift check (run first)**: `git diff --stat 0718e2d..HEAD -- src/lib/ewcPredictions.js src/db/ewcPredictions.js src/lib/ewcPredictionAdmin.js scripts tests/ewcPredictionScoring.test.mjs`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `0718e2d`, 2026-07-23

## Why this matters

The bot's stated community timezone is `Asia/Riyadh`, but official EWC date-only
overrides are converted through `Europe/Paris`. During July and August 2026,
Paris is UTC+2 and Riyadh is UTC+3, so openings, locks, event ends, and scoring
deadlines are generated one hour late. Correcting only the pure function would
leave already stored active rounds wrong, so this plan includes a guarded data
reconciliation.

## Current state

- `src/lib/ewcPredictions.js:3-4` defines `RIYADH_OFFSET = '+03:00'` but sets
  `EWC_EVENT_TIME_ZONE = 'Europe/Paris'`.
- `ewcEventDay` at lines 428-432 converts official date strings through that
  timezone; `applyOfficialEwc2026EventDates` at lines 487-495 overwrites parsed
  event timestamps with the result.
- `generateEwcWeekWindows` uses the same timezone for year detection and emits
  persisted `startAt`, `endAt`, `lockAt`, `openAt`, `closeAt`, and `scoreAfter`.
- Existing parser tests already document Riyadh midnight epochs in
  `tests/liquipediaParsers.test.mjs:222-226`.
- `upsertEwcWeek` overwrites stored timing/game JSON on regeneration, but there
  is no dry-run report for impacted picks.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Schedule tests | `node --test tests/ewcPredictionScoring.test.mjs tests/ewcPredictionTimezoneReconcile.test.mjs` | all pass |
| Reconcile dry-run | `node scripts/reconcile-ewc-2026-timezone.mjs` | exit 0; prints aggregate changes and performs no writes |
| Bot suite | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

## Scope

**In scope**:

- `src/lib/ewcPredictions.js`
- `src/db/ewcPredictions.js` for a narrowly scoped transactional timing update
- `scripts/reconcile-ewc-2026-timezone.mjs` (new)
- `tests/ewcPredictionScoring.test.mjs`
- `tests/ewcPredictionTimezoneReconcile.test.mjs` (new)
- `.env.example` only if the script introduces an environment variable; prefer
  existing `DB_DRIVER`, `DB_PATH`, and `DATABASE_URL`

**Out of scope**:

- Event names, official date tables, score values, or season rollover.
- Stable game-key migration; plan 130 owns that.
- Automatically invalidating historical picks or changing published scores.
- Network calls from the reconciliation script.

## Git workflow

- Branch: `codex/128-ewc-riyadh-boundaries`
- Commit style: `fix(predictions): use Riyadh for official EWC boundaries`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Freeze exact official epochs

Add table-driven tests for every entry in `EWC_2026_OFFICIAL_EVENT_DATES`.
Assert each start is 00:00 Asia/Riyadh (`21:00:00Z` on the previous UTC day)
and each end is 23:59:59 Riyadh. Include at least one July and August event,
the official week boundaries, `lockAt`, and `scoreAfter`.

Assert the output is independent of the process `TZ` by running a child test
under two different `TZ` values if needed.

**Verify**: the exact-epoch assertions fail by 3,600 seconds before the fix.

### Step 2: Use Riyadh consistently in generation

Replace the Paris event timezone with `Asia/Riyadh` and rename any misleading
constant. Keep the existing timezone-offset algorithm unless tests prove a
simpler `+03:00` conversion is more deterministic. Use the same zone for year
detection, official weeks, event overrides, and default season windows.

Do not change the generic `parsePredictionDate` contract beyond making its
existing Riyadh intent explicit.

**Verify**: schedule tests pass with the exact epochs and no one-hour drift.

### Step 3: Build a pure stored-round reconciliation model

Add a pure helper that accepts a stored 2026 week and returns:

- corrected week timing fields;
- corrected event `startAt`, `endAt`, and `lockAt` while preserving keys and
  all non-time metadata;
- a field-by-field diff and the old/new invalid submission interval.

The helper must refuse non-2026 seasons and events that cannot be uniquely
matched to an official override. It must not reorder events or change keys.

**Verify**: unit tests cover unchanged rows, a one-hour correction, ambiguous
events, and idempotent second execution.

### Step 4: Add a dry-run-first reconciliation command

Create `scripts/reconcile-ewc-2026-timezone.mjs`. It must read stored 2026 weeks,
use the pure model, and report only aggregate counts by week/game:

- fields that would change;
- predictions with `pickedAt` in `[newLockAt, oldLockAt)`;
- whether a week is already scored.

Default to no writes. Require `--apply` plus an explicit confirmation flag to
update rows in one transaction. Refuse apply when affected picks exist or any
week is scored; print a STOP message instead. Never print user IDs or pick
values.

**Verify**: an integration fixture proves dry-run is unchanged, safe apply is
atomic/idempotent, and affected/scored fixtures are rejected without writes.

### Step 5: Run all gates and produce the operator handoff

Run the dry-run only against the configured non-production development DB. In
the PR description, instruct the operator to run the dry-run against production
and review aggregate output before a separately authorized apply. Do not run
`--apply` against production as part of implementation.

## Test plan

- Exact UTC epochs for every official date and week boundary.
- Child-process timezone independence.
- Pure reconciliation diff and idempotence.
- Disposable-DB dry-run/apply/refusal paths.
- Regression: game keys and order are byte-for-byte unchanged by this plan.

## Done criteria

- [ ] All official EWC date-only boundaries use Asia/Riyadh.
- [ ] July/August epochs are no longer one hour late.
- [ ] Existing rows can be inspected and safely reconciled without network use.
- [ ] Dry-run is the default and apply refuses affected/scored data.
- [ ] No member identifiers or picks appear in reconciliation output.
- [ ] All repository gates pass.

## STOP conditions

- Any production-like row contains a pick in the corrected lock interval.
- Any affected round is already scored or announced as final.
- Correcting timestamps requires changing event keys/order.
- Stored event metadata cannot be uniquely matched to an official override.

## Maintenance notes

Date-only EWC schedules are Riyadh calendar dates. Future season constants need
exact-epoch tests at creation time; never infer the event calendar through a
DST-observing European zone.
