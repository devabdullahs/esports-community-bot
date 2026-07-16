# Plan 118: Add public predictor profile pages

> **Executor instructions**: The user requested public identities by default.
> Preserve safety by exposing only prediction-facing profile fields and no raw
> Discord identifiers beyond what already appears in public leaderboards.
>
> **Drift check**: `git diff --stat 27a04f8..HEAD -- src/db/ewcProfileLinks.js src/db/ewcPredictions.js apps/web/src/app/predictions/page.tsx apps/web/src/components/dashboard/profile-dashboard.tsx`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/108-add-predictor-achievements.md optional
- **Category**: direction
- **Planned at**: commit `27a04f8`, 2026-07-17

## Why this matters

Prediction identity should be shareable. Public predictor pages let members show
rank, badges, favorite picks, and recent performance without exposing private
settings or account controls.

## Current state

- `src/db/ewcProfileLinks.js` links Discord identities to web profiles.
- Prediction leaderboards already display public leaderboard rows.
- `/me` has account controls that must remain private.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `npm --workspace @esports-community-bot/web run test -- public-predictor` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Bot tests | `npm test` | all pass |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- Public slug/token lookup helper.
- `apps/web/src/app/predictors/[id]/page.tsx` (create).
- Public predictor card/list links from leaderboard rows.
- Metadata and sitemap updates.
- tests.

**Out of scope**:
- Account settings, notification settings, follows list, or hidden picks.
- DMs, email, auth session data, raw Discord tokens.
- Anonymous-mode toggle unless product reverses the latest request.

## Steps

### Step 1: Define public projection

Return display name, avatar proxy URL, rank, points, weeks, wins, sweeps,
achievements, and public recent results. Hide private account identifiers and
pre-lock picks.

**Verify**: tests recursively assert no private fields.

### Step 2: Add public page

Render a clean profile page with prediction stats, achievements, recent weeks,
and a link back to the leaderboard. Add EN/AR metadata.

**Verify**: page tests cover found, not found, and RTL.

### Step 3: Link from leaderboards

Make leaderboard member names link to the public page. If a user has no profile
link, generate or expose a stable public route according to the decided default.

**Verify**: leaderboard tests cover link presence.

## Done criteria

- [ ] Predictor pages are public and shareable.
- [ ] No private account controls or hidden picks appear.
- [ ] Leaderboards link to predictor pages.
- [ ] Full verification passes.

## STOP conditions

- Product decision changes back to opt-in privacy.
- Existing profile links cannot provide stable public identifiers without a
  migration.

## Maintenance notes

If privacy policy text mentions anonymous predictor identity, update it in the
same PR to match the new default.
