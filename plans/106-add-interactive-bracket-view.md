# Plan 106: Add interactive playoff bracket views

> **Executor instructions**: Render brackets from stored match data only. Do
> not scrape bracket HTML or add new provider calls.
>
> **Drift check**: `git diff --stat 27a04f8..HEAD -- apps/web/src/lib/tournaments.ts apps/web/src/components/tournaments/tournament-match-list.tsx src/db/matches.js`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/102-add-live-match-center.md optional
- **Category**: direction
- **Planned at**: commit `27a04f8`, 2026-07-17

## Why this matters

Playoff brackets are the natural way esports fans understand tournament state.
The site currently lists matches and standings, but bracket-stage tournaments
need a visual path from quarterfinals to finals.

## Current state

- `apps/web/src/lib/tournaments.ts` returns match rows with tournament, round,
  status, teams, scores, winner, and schedule fields.
- `apps/web/src/components/tournaments/tournament-match-list.tsx` renders lists
  but not bracket lanes.
- Some games have battle royale/standings-only formats; brackets must only show
  when the match data supports them.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `npm --workspace @esports-community-bot/web run test -- bracket-view` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Bot tests | `npm test` | all pass |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- `apps/web/src/lib/tournament-brackets.ts` (create)
- `apps/web/src/components/tournaments/bracket-view.tsx` (create)
- `apps/web/src/components/tournaments/tournament-match-list.tsx`
- `apps/web/src/lib/i18n.ts`
- tests.

**Out of scope**:
- Fetching or parsing Liquipedia bracket HTML.
- Editing match ingestion.
- Predicting future opponents beyond stored TBD rows.

## Steps

### Step 1: Derive a bracket model

Create a pure function that groups matches by stage/round name and orders them
by scheduled time/id. Recognize common labels such as quarterfinals, semifinals,
grand final, lower/upper bracket, and third-place match. Return `null` if fewer
than two bracket-like rounds exist.

**Verify**: unit tests cover LoL-style single elimination, lower/upper bracket
labels, TBD rows, and standings-only events.

### Step 2: Render responsive brackets

Add a bracket tab/section above match lists when a bracket model exists. On
mobile, use horizontal scroll with sticky round headers. On desktop, use columns.
Use team logos through existing safe logo components only.

**Verify**: web tests cover the tab/section presence and empty fallback.

### Step 3: Link cards to match details

If a match has details, the bracket card should link to `/matches/[id]`; otherwise
it links to the tournament row anchor or remains inert.

**Verify**: tests assert link behavior for both cases.

## Test plan

- Pure bracket model unit tests.
- Component render tests for desktop-ish structure and RTL order.
- E2E visual QA if plan 094 exists.

## Done criteria

- [ ] Brackets appear only for suitable tournaments.
- [ ] Match lists remain available.
- [ ] Mobile and RTL layouts do not overlap.
- [ ] Full verification passes.

## STOP conditions

- Stored match rows do not include enough stage/round information for a useful
  bracket without parsing external HTML.

## Maintenance notes

New game formats should be added as fixture tests before changing bracket
recognition heuristics.
