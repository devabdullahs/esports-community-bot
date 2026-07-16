# Plan 119: Add a compare-me prediction widget

> **Executor instructions**: This is a small derived stats feature. Do not add
> new scoring or ranking tables.
>
> **Drift check**: `git diff --stat 27a04f8..HEAD -- src/db/ewcPredictions.js apps/web/src/components/dashboard/profile-dashboard.tsx apps/web/src/lib/ewc-profile-sync.ts`

## Status

- **Priority**: P3
- **Effort**: S-M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `27a04f8`, 2026-07-17

## Why this matters

"You beat 84% of predictors this week" is a simple, sticky stat that makes
prediction results feel personal. It reuses existing scores and rankings.

## Current state

- `src/db/ewcPredictions.js` computes overall rank and leaderboard rows.
- `/me` shows rank, points, weeks predicted, and wins.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Bot tests | `npm test` | all pass |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- Add percentile/compare helper to prediction stats.
- UI widget in `/me`.
- tests.

**Out of scope**:
- Mini-leagues; plan 107 covers those.
- New score math.
- Public brag-card rendering; plan 113 covers share cards.

## Steps

### Step 1: Add percentile helper

Compute percentile from rank and total ranked users. Include weekly and overall
variants only if data is already available without N+1 queries.

**Verify**: tests cover first, middle, last, tied rank, unranked, and zero users.

### Step 2: Render the widget

Add a small card to `/me` that says how the user compares overall and for the
latest scored week. Use careful copy for unranked users.

**Verify**: component tests cover ranked and unranked copy in EN/AR.

## Done criteria

- [ ] Widget appears on `/me`.
- [ ] Percentile math is tested and handles ties gracefully.
- [ ] No new score persistence.
- [ ] Full verification passes.

## STOP conditions

- Total ranked users cannot be fetched efficiently from existing helpers.

## Maintenance notes

If plan 107 mini-leagues lands later, add a mini-league compare variant as a
separate plan.
