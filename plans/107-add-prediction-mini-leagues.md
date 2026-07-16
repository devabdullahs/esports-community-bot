# Plan 107: Add private prediction mini-leagues

> **Executor instructions**: Build mini-leagues on top of existing prediction
> scores. Do not fork scoring logic.
>
> **Drift check**: `git diff --stat 27a04f8..HEAD -- src/db/ewcPredictions.js apps/web/src/app/predictions/page.tsx apps/web/src/lib/ewc-profile-sync.ts`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `27a04f8`, 2026-07-17

## Why this matters

Private groups are a strong retention loop for prediction games. Members can
compete with friends or media communities without splitting the official public
leaderboard.

## Current state

- `src/db/ewcPredictions.js` already computes weekly, season, and overall
  leaderboards.
- Public prediction pages show global results.
- Authenticated `/me` and prediction routes already have Discord identity.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Bot tests | `npm test` | all pass |
| Focused web tests | `npm --workspace @esports-community-bot/web run test -- mini-leagues` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- New tables in `src/db/index.js` for leagues and memberships.
- `src/db/ewcPredictionLeagues.js` (create).
- Authenticated routes under `apps/web/src/app/api/me/prediction-leagues/`.
- UI under `/me` and `/predictions`.
- Tests.

**Out of scope**:
- Paid leagues.
- Cross-guild support.
- Custom scoring.
- Discord role automation.

## Steps

### Step 1: Add league and membership tables

Store league id, name, owner user id, invite code hash or random public code,
season, created/archived timestamps, and memberships. Enforce owner and member
boundaries. Codes must be unguessable.

**Verify**: DB tests cover create, join, leave, owner archive, duplicate joins,
and invalid code.

### Step 2: Add league leaderboard projection

Reuse existing overall leaderboard scores and filter to member user IDs. Do not
copy or recompute score math. Include users with zero scored points if they have
submitted predictions for completed weeks.

**Verify**: tests cover rank ties and zero-score members.

### Step 3: Add UI

Add create/join/manage screens using shadcn cards, dialogs, input, and table
patterns. Make invite sharing easy. Keep the official public leaderboard clearly
separate.

**Verify**: web tests cover create/join/list and auth boundaries.

## Test plan

- DB lifecycle tests.
- API tests for owner/member boundaries and invite validation.
- Leaderboard projection tests.
- E2E create/join journey if plan 094 exists.

## Done criteria

- [ ] Users can create, join, leave, and archive mini-leagues.
- [ ] Mini-league leaderboard uses official scores.
- [ ] Invite codes are not enumerable.
- [ ] Full verification passes.

## STOP conditions

- Existing overall leaderboard cannot be filtered without duplicating scoring.
- The implementation needs multi-guild assumptions.

## Maintenance notes

Mini-leagues are social surfaces. Add moderation/reporting only if abuse appears;
do not overbuild v1.
