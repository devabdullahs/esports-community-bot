# Plan 105: Show community pick distribution after lock

> **Executor instructions**: Keep pick values hidden before lock. Run every
> verification command and stop on any privacy or scoring boundary mismatch.
>
> **Drift check**: `git diff --stat 27a04f8..HEAD -- src/db/ewcPredictions.js src/lib/ewcPredictionRounds.js apps/web/src/lib/ewc-profile-sync.ts apps/web/src/components/dashboard/profile-dashboard.tsx`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `27a04f8`, 2026-07-17

## Why this matters

Pick distribution is one of the highest-value social features in prediction
games. It creates community conversation without changing scoring. The key rule
is simple: never show distribution before the round locks.

## Current state

- `src/db/ewcPredictions.js` stores weekly predictions in
  `ewc_weekly_predictions.picks_json`.
- `apps/web/src/lib/ewc-profile-sync.ts` already computes actionable rounds and
  must remain the source of truth for deadline state.
- Prediction pages and `/me` already render weekly prediction state.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Bot tests | `npm test` | all pass |
| Focused web tests | `npm --workspace @esports-community-bot/web run test -- pick-distribution` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- Read-only aggregate helper in `src/db/ewcPredictions.js`.
- `apps/web/src/lib/prediction-pick-distribution.ts` (create).
- UI component on prediction round cards.
- Tests.

**Out of scope**:
- Changing score values, winner rules, or pick storage.
- Showing individual user picks.
- Discord command UI changes.

## Steps

### Step 1: Add an aggregate helper

Add a helper that returns counts per game/club pick for a week. It must only
accept a week ID whose lock time has passed or whose status is closed/scored.
If status is open and `nowSec < lock_at`, return an empty locked response.

**Verify**: tests prove pre-lock returns no counts and post-lock returns totals.

### Step 2: Render bars after lock

On weekly prediction views, show percentages and counts after lock. Use a
compact shadcn-style progress/list pattern with no chart dependency unless
already used on the page. Handle ties and zero picks.

**Verify**: web tests cover locked, unlocked, no picks, and RTL labels.

### Step 3: Add API projection if needed

If the page cannot fetch the aggregate through an existing payload, add a
read-only route under `/api/ewc/.../pick-distribution`. It must be public only
after lock; before lock it may return `locked:false` and no pick counts.

**Verify**: unauthorized state is irrelevant because no private data is returned
after lock, but tests must prove pre-lock privacy.

## Test plan

- DB aggregate tests against sample picks.
- Web route tests for pre-lock and post-lock.
- Snapshot-free component assertions for visible labels and percentages.

## Done criteria

- [ ] No pre-lock counts leak.
- [ ] Post-lock distribution is visible on EN and AR prediction pages.
- [ ] Scoring code is untouched.
- [ ] Full verification passes.

## STOP conditions

- Existing round status does not expose enough information to decide lock state.
- Implementing this requires changing prediction write semantics.

## Maintenance notes

This feature will amplify popular picks. Keep the post-lock rule in tests so it
does not regress during future prediction UI refactors.
