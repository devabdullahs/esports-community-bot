# Plan 116: Add MVP of the day voting

> **Executor instructions**: Keep voting bounded, daily, and abuse-resistant.
> This is not a prediction score source.
>
> **Drift check**: `git diff --stat 27a04f8..HEAD -- src/db/players.js src/db/matches.js apps/web/src/app/players apps/web/src/lib/i18n.ts`

## Status

- **State**: Completed
- **Priority**: P3
- **Effort**: M-L
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `27a04f8`, 2026-07-17

## Why this matters

Daily votes create light engagement between match days and give players more
visibility. It should be fun and low-stakes, not a competitive ranking that can
be gamed for rewards.

## Current state

- Player pages and match details exist.
- Comments/likes already prove authenticated member interactions can be safely
  gated.
- There is no voting table yet.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Bot tests | `npm test` | all pass |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- New DB tables for daily vote sessions and votes.
- Public daily vote page and authenticated vote route.
- Admin read-only results view if lightweight.
- tests.

**Out of scope**:
- Prizes, Discord roles, or paid voting.
- Unlimited nominees.
- Anonymous voting.

## Steps

### Step 1: Model daily vote sessions

Create a session per date/game or per site-wide day. Nominees should come from
players in recently finished matches or be admin-curated if automatic nominee
quality is poor. One vote per user/session.

**Verify**: DB tests cover one vote, change vote, closed session, and invalid
nominee.

### Step 2: Add public vote UI

Show nominees with player images, team/game, and vote counts after voting or
after close. Before vote, avoid showing live totals if that skews behavior.

**Verify**: web tests cover unauthenticated CTA and authenticated vote.

### Step 3: Add results surfaces

Add "MVP of the day" to home or player pages after a session closes. Keep it
small and link to the full vote page.

**Verify**: route tests cover closed-session result projection.

## Done criteria

- [x] One vote per verified member per session.
- [x] Voting does not affect prediction scores.
- [x] Abuse controls and moderation copy are clear.
- [x] Full verification passes.

## STOP conditions

- Automatic nominee quality is too low without a broader match-details player
  coverage plan.

## Maintenance notes

If abuse occurs, add admin-curated sessions and rate limits before considering
public nomination.
