# Plan 114: Add language and game filters to co-streams

> **Executor instructions**: This is a UI/filtering refinement. Do not change
> stream grouping or status polling.
>
> **Drift check**: `git diff --stat 27a04f8..HEAD -- apps/web/src/components/streams/co-streams-view.tsx apps/web/src/lib/co-streams.ts src/db/streamChannels.js`

## Status

- **Priority**: P2
- **Effort**: S-M
- **Risk**: LOW
- **Depends on**: plans/093-add-co-stream-multiview.md
- **Category**: direction
- **Planned at**: commit `27a04f8`, 2026-07-17

## Why this matters

The co-stream directory is growing. Users should quickly filter by Arabic,
English, or game instead of scanning all creators.

## Current state

- `apps/web/src/components/streams/co-streams-view.tsx` already maintains
  platform, game, live-only, and selected stream state.
- Stream rows include game tags and language information.
- Multiview behavior from plan 093 should remain intact.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `npm --workspace @esports-community-bot/web run test -- co-streams` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- `apps/web/src/components/streams/co-streams-view.tsx`
- `apps/web/src/lib/co-stream-filtering.ts` (create if helpful)
- tests.

**Out of scope**:
- Admin stream schema changes.
- New platform support.
- Multiview layout rules.

## Steps

### Step 1: Extract filter logic

Move filtering into a pure helper that accepts streams, platform, game, language,
and live-only. Normalize language codes and include an "all" option.

**Verify**: tests cover platform+game+language combinations and no matches.

### Step 2: Add filter UI

Use shadcn/Base UI select or command controls. Keep desktop compact and mobile
stacked. Show active filter badges and a clear-filters button.

**Verify**: web tests cover selecting Arabic and clearing filters.

### Step 3: Preserve selection

When filters hide the currently selected stream, select the first visible live
stream; when filters clear, preserve the previous selected id if still present.

**Verify**: tests cover selected-stream stability.

## Done criteria

- [ ] Users can filter co-streams by language and game.
- [ ] No stream grouping/status logic changes.
- [ ] EN/AR UI works without overflow.
- [ ] Verification passes.

## STOP conditions

- Stream rows do not carry reliable language data and require admin data repair.

## Maintenance notes

Keep filter logic pure so it can be reused by the live match center or homepage
co-stream strip later.
