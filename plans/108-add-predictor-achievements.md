# Plan 108: Add predictor achievements and streak badges

> **Executor instructions**: Achievements must be derived from existing
> prediction results. Do not alter score math.
>
> **Drift check**: `git diff --stat 27a04f8..HEAD -- src/lib/ewcProfileStats.js src/db/ewcPredictions.js apps/web/src/components/dashboard/profile-dashboard.tsx`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `27a04f8`, 2026-07-17

## Why this matters

Achievements turn prediction results into identity and long-term motivation.
The site already stores per-pick details and profile stats, so this is mostly a
derived display layer.

## Current state

- `src/lib/ewcProfileStats.js` derives prediction profile stats.
- `src/db/ewcPredictions.js` stores weekly details and overall leaderboard data.
- `/me` shows prediction profile cards.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Bot tests | `npm test` | all pass |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- `src/lib/ewcPredictionAchievements.js` (create).
- Extend `src/lib/ewcProfileStats.js` projection.
- UI in prediction profile and public leaderboard rows.
- Tests.

**Out of scope**:
- New scoring values.
- Discord roles until explicitly requested.
- Manual admin-awarded badges.

## Steps

### Step 1: Define achievement rules

Implement pure derived rules such as weekly winner, top 10, top 20, perfect week,
streak length, game specialist, and consistent predictor. Keep thresholds in one
constant map with labels for EN/AR.

**Verify**: pure tests cover every rule, ties, zero scores, and no predictions.

### Step 2: Add profile projection

Attach badge ids and compact stats to the profile payload. Do not expose hidden
picks before lock.

**Verify**: existing profile tests still pass and new tests assert badge ids.

### Step 3: Render badges

Use icons and compact badges on `/me`, `/predictions`, and public predictor
surfaces if plan 118 has landed. Avoid cluttering table rows with more than
three visible badges; show the rest in a tooltip/dialog.

**Verify**: component or route tests cover visible and overflow badges.

## Done criteria

- [ ] Achievement rules are pure, tested, and documented in code comments.
- [ ] UI is localized and RTL-safe.
- [ ] Score math is untouched.
- [ ] Full verification passes.

## STOP conditions

- Required per-pick details are missing for a badge rule.
- A requested badge would require subjective/manual admin judgment.

## Maintenance notes

Future seasons can reuse the same rules by changing the season filter only.
