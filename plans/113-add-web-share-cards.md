# Plan 113: Add downloadable web share cards

> **Executor instructions**: Reuse existing canvas/card renderers where
> possible and keep render routes authenticated/rate-limited.
>
> **Drift check**: `git diff --stat 27a04f8..HEAD -- src/lib/ewcShareCard.js src/lib/ewcPredictionLeaderboardCard.js apps/web/src/components/dashboard/profile-dashboard.tsx apps/web/src/app/api/me/ewc`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `27a04f8`, 2026-07-17

## Why this matters

Prediction rank and profile cards are highly shareable. The bot already renders
PNG cards for Discord; exposing safe, authenticated downloads on the website
helps members promote the site organically.

## Current state

- `src/lib/ewcShareCard.js` and `src/lib/ewcPredictionLeaderboardCard.js`
  contain canvas card rendering logic.
- `/me` already knows the signed-in Discord user and prediction stats.
- Asset/logo proxy policies have been hardened; do not bypass them.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Bot tests | `npm test` | all pass |
| Focused web tests | `npm --workspace @esports-community-bot/web run test -- share-card` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- `apps/web/src/app/api/me/share-card/route.ts` (create)
- Small render adapter if needed under `apps/web/src/lib/share-card.ts`
- UI button on `/me` prediction profile.
- tests.

**Out of scope**:
- Public unauthenticated rendering.
- Arbitrary text/image uploads.
- New card designs for every site page.

## Steps

### Step 1: Create a safe render route

Add an authenticated route that renders the signed-in user's card only. Validate
variant params with a strict enum. Rate-limit per user/IP using existing rate
limit helpers. Return `image/png` and cache privately or no-store.

**Verify**: tests cover unauthenticated 401, invalid variant 400, and successful
PNG headers with mocked renderer.

### Step 2: Reuse renderer inputs

Build card inputs from existing profile/leaderboard helpers. Do not accept
display name, avatar URL, score, or rank from the request body.

**Verify**: tests prove request-provided spoof fields are ignored.

### Step 3: Add UI

Add "Share card" / "Download card" actions in `/me`. Use a menu if several
variants exist. Provide loading and error states.

**Verify**: component or route tests cover the action link.

## Done criteria

- [ ] Only the signed-in user's data can be rendered.
- [ ] Route is rate-limited and no-store/private.
- [ ] PNG renders in local verification.
- [ ] Full verification passes.

## STOP conditions

- Canvas renderer cannot run in the web runtime without broader dependency or
  Docker changes.
- The route would need to accept arbitrary external image URLs.

## Maintenance notes

If sponsor/branded templates arrive later, split them into admin-only renderer
variants rather than expanding the member route.
