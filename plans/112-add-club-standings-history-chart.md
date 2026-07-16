# Plan 112: Add Club Championship standings history charts

> **Executor instructions**: Use stored snapshot history only. Do not fetch
> Liquipedia during a page request.
>
> **Drift check**: `git diff --stat 27a04f8..HEAD -- src/db/ewcClubChampionshipSnapshots.js apps/web/src/components/clubs apps/web/src/app/tournaments/ewc/page.tsx`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/080-add-ewc-club-standings-leaderboard.md
- **Category**: direction
- **Planned at**: commit `27a04f8`, 2026-07-17

## Why this matters

The standings table shows the current race, but fans want momentum: who gained,
who dropped, and when points arrived. Stored snapshots can power this without
any new provider load.

## Current state

- `src/db/ewcClubChampionshipSnapshots.js` stores Club Championship snapshots.
- `apps/web/src/components/clubs/ewc-club-standings-table.tsx` renders the
  current leaderboard.
- Recharts is already installed in the web app.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `npm --workspace @esports-community-bot/web run test -- club-history` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- Snapshot history query helper.
- `apps/web/src/lib/ewc-club-history.ts` (create)
- `apps/web/src/components/clubs/ewc-club-history-chart.tsx` (create)
- EWC standings page integration.
- tests.

**Out of scope**:
- Changing snapshot collection cadence.
- Manual point overrides.
- New monetization reporting.

## Steps

### Step 1: Add history projection

Return top N clubs plus selected club series over time, with timestamp, points,
rank, and delta from previous snapshot. Cap rows by days/snapshot count.

**Verify**: tests cover duplicate snapshots, missing clubs, ties, and caps.

### Step 2: Render charts and deltas

Use Recharts with the existing admin analytics chart style as reference. Add a
compact "biggest movers" list. Respect dark theme and RTL.

**Verify**: web tests assert series data is passed and empty state renders.

### Step 3: Add club detail drill-down

Clicking a club row should filter or open its history without navigating away.
Use a query param so the selection is shareable.

**Verify**: route/search param tests cover selected club.

## Done criteria

- [ ] Current standings remain unchanged.
- [ ] History uses stored snapshots only.
- [ ] Chart is accessible with table/list fallback.
- [ ] Full verification passes.

## STOP conditions

- Snapshot table does not retain enough history in production.
- Recharts output causes build/hydration issues that need a broader chart setup.

## Maintenance notes

This history later supports sponsor reporting. Keep the projection bounded and
stable rather than exposing full raw snapshots.
