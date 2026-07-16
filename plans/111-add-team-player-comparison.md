# Plan 111: Add team and player comparison pages

> **Executor instructions**: This is read-only composition of stored profiles.
> Do not trigger enrichment from comparison requests.
>
> **Drift check**: `git diff --stat 27a04f8..HEAD -- src/db/teams.js src/db/players.js apps/web/src/app/teams apps/web/src/app/players apps/web/src/lib/profiles.ts`

## Status

- **Priority**: P2
- **Effort**: M-L
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `27a04f8`, 2026-07-17

## Why this matters

Fans often compare rosters, regions, winnings, recent matches, and achievements
before big games. The site already enriches teams and players; comparison pages
turn that data into a useful exploration tool.

## Current state

- `src/db/teams.js` and `src/db/players.js` store enriched public profiles.
- `apps/web/src/app/teams/[id]/page.tsx` and
  `apps/web/src/app/players/[id]/page.tsx` render individual profiles.
- Search pages already list teams/players.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `npm --workspace @esports-community-bot/web run test -- compare-profiles` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- `apps/web/src/app/compare/page.tsx` (create)
- `apps/web/src/app/compare/teams/page.tsx` (create if preferred)
- `apps/web/src/app/compare/players/page.tsx` (create if preferred)
- `apps/web/src/components/profiles/profile-compare.tsx` (create)
- `apps/web/src/lib/profile-comparison.ts` (create)
- tests.

**Out of scope**:
- New enrichment jobs.
- Private user data.
- Ranking algorithms that claim predictive accuracy.

## Steps

### Step 1: Add profile search selectors

Build a selector UI with autocomplete/search using existing public team/player
queries. Support URL params so comparisons are shareable.

**Verify**: tests cover valid/invalid ids and empty state.

### Step 2: Add comparison projection

Create a read-only projection with normalized fields: region, current team,
game, approximate winnings, achievements count/list, active roster, recent
matches, and profile links. Omit raw Liquipedia payloads.

**Verify**: tests assert no `raw`, `liquipedia_raw`, token, or private field is
returned.

### Step 3: Render side-by-side

Use responsive columns on desktop and stacked sections on mobile. Highlight
differences with badges, not large marketing cards.

**Verify**: mobile and RTL layouts do not overflow.

## Done criteria

- [ ] Users can compare two teams or two players from public data.
- [ ] URLs are shareable.
- [ ] No enrichment/fetch is triggered by the page.
- [ ] Full verification passes.

## STOP conditions

- Public profile helper APIs expose raw enrichment payloads and require
  hardening beyond this page.

## Maintenance notes

This page can later link from match pages: "Compare these teams" or "Compare
these players." Keep the projection reusable.
