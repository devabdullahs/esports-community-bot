# Plan 086: Make prediction ranks tie-aware on every surface

> **Executor instructions**: This is a scoring-presentation semantics change,
> not a point-formula change. Implement competition ranking consistently and
> run every pagination/profile regression. Stop if an existing documented rule
> explicitly uses submission time or Discord ID as a tiebreaker.
>
> **Drift check (run first)**: `git diff --stat 2301227..HEAD -- src/db/ewcPredictions.js src/lib/ewcProfileStats.js src/commands/ewc_predict.js src/lib/ewcPredictionLeaderboardCard.js tests/ewcPredictionLifecycle.test.mjs tests/ewcProfileStats.test.mjs apps/web/src/components/dashboard/leaderboard-table.tsx apps/web/src/test/ewc-leaderboard.test.ts`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `2301227`, 2026-07-10

## Why this matters

Two members with the same score currently receive different ranks based on
submission time (weekly/season) or Discord ID (overall). The Discord linked-role
metadata can therefore call one member rank 1 and another rank 2 even though
the system counts both as weekly winners. Competition ranking must be computed
once from score alone and carried through Discord embeds/cards, web pagination,
profiles, and role metadata. A week whose highest score is zero should remain a
leaderboard tie but should not grant a `Weekly Win` achievement.

## Current state

- `src/db/ewcPredictions.js:272-281` orders weekly rows by score then
  `updated_at`; `seasonLeaderboard` does the same at lines 442-451.
- `src/db/ewcPredictions.js:540-547` uses `ROW_NUMBER()` ordered by score and
  user ID for `overallRankForUser`.
- `src/commands/ewc_predict.js:461-465` invents ranks from page offset/index.
- `src/lib/ewcProfileStats.js:295-307` also invents public web ranks from
  offset/index.
- `src/lib/ewcPredictionLeaderboardCard.js:316-324` labels image rows using
  `index + 1`.
- `src/lib/ewcProfileStats.js:95-111` counts every row tied at `MAX(score)` as a
  weekly win, including `MAX(score) = 0`.
- Weekly performance deltas already use shared competition ranks at
  `src/lib/ewcPredictions.js:160-167`; this is the semantics to match: 1, 1, 3.
- Plan 077 already fixed web pagination. Preserve its one server-pagination
  model and privacy-safe rows.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused bot tests | `node --test tests/ewcPredictionRankings.test.mjs tests/ewcPredictionLifecycle.test.mjs tests/ewcProfileStats.test.mjs` | all pass |
| Focused web tests | `npm --workspace @esports-community-bot/web run test -- src/test/ewc-leaderboard.test.ts src/test/leaderboard-page-model.test.ts` | all pass |
| Bot suite | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

## Scope

**In scope**:

- `src/db/ewcPredictions.js`
- `src/lib/ewcProfileStats.js`
- `src/commands/ewc_predict.js`
- `src/jobs/ewcPredictions.js` only where rows are projected for images
- `src/lib/ewcPredictionLeaderboardCard.js`
- `apps/web/src/components/dashboard/leaderboard-table.tsx`
- Focused bot/web ranking tests, including new
  `tests/ewcPredictionRankings.test.mjs`

**Out of scope**:

- Point values, bonuses, best-N-week selection, or season scoring formulas.
- Publicly exposing Discord IDs.
- Opt-in display names; plan 091 owns identity.
- Reworking pagination beyond consuming canonical rank values.

## Git workflow

- Branch: `advisor/086-tie-aware-prediction-ranks`
- Suggested commit: `fix: assign shared prediction ranks for tied scores`
- Do not push or open a PR unless requested.

## Steps

### Step 1: Characterize tie semantics across pages

Create fixtures with scores `[100, 100, 50, 0, 0]`, enough rows to cross a
page boundary, and deliberately varied submission times/user IDs. Assert the
target competition ranks `[1, 1, 3, 4, 4]` independent of secondary ordering.
Add a separate all-zero week and assert no `weeklyWins` increment.

**Verify**: new tests fail against positional/`ROW_NUMBER` behavior.

### Step 2: Return canonical rank from leaderboard SQL

For weekly, season, and overall leaderboards, compute
`RANK() OVER (ORDER BY score DESC)` in a CTE before `LIMIT/OFFSET`. Use a stable
secondary display order outside the window (existing timestamp/user order is
fine) without putting it inside `RANK()`.

Refactor `overallRankForUser` to consume the same ranked overall CTE/query shape
as `overallLeaderboard`, so a profile and a paginated list cannot disagree.
Keep the best-N weekly CTE exactly equivalent to current behavior.

**Verify**: DB tests pass on SQLite. Inspect SQL for `$n` placeholders and run
against a disposable Postgres database when available.

### Step 3: Carry rank through all projections

Use `row.rank` in:

- Discord leaderboard lines and page transitions;
- the persistent leaderboard image row model;
- public web rows, including pages after page one;
- user profile stats and Discord role metadata.

Never infer rank from array position after this step. Keep raw `user_id` out of
the public JSON response.

**Verify**: search relevant files for `offset + index + 1` and `index + 1` rank
construction; only unrelated visual indices may remain.

### Step 4: Exclude zero-point ties from weekly wins

Apply the product rule: a weekly win requires matching the week's maximum and
that maximum must be greater than zero. Apply it to single-user and batched
profile-stat queries. This changes achievements/role metadata, not leaderboard
rank display.

**Verify**: one participant scoring zero and multiple participants tied at zero
all receive zero weekly wins; positive ties all receive one.

### Step 5: Run full gates and compare surfaces

Run every command. With a seeded tied fixture, compare `/ewc_predict
leaderboard`, the persistent card, `/leaderboard`, `/me`, and role payload; all
must show the same rank.

## Test plan

- New DB tests cover weekly, season, and overall ties, tie crossing pagination,
  stable order, best-N weeks, and zero-win policy.
- Extend public API tests to prove canonical page-two ranks and absent user IDs.
- Extend card model tests so tied rows display repeated rank values.
- Keep existing scoring-math tests unchanged.

## Done criteria

- [ ] Equal scores always receive equal competition rank.
- [ ] Rank is computed before pagination and remains correct on later pages.
- [ ] Discord, web, profile, image, and linked-role metadata agree.
- [ ] A maximum weekly score of zero grants no weekly win.
- [ ] Public rows still omit Discord IDs.
- [ ] All required repo checks pass.

## STOP conditions

- Product documentation explicitly declares submission time or Discord ID a
  competitive tiebreaker.
- The deployed SQLite version lacks required window-function support.
- Canonical ranking cannot be shared without changing best-N score totals.

## Maintenance notes

Stable ordering and competitive ranking are different concerns: future code
may add a display tiebreaker, but it must remain outside the `RANK()` window.
Plan 091 should consume these canonical rank values unchanged.

