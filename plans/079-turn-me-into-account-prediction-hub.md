# Plan 079: Turn `/me` and `/predictions` into one coherent account and prediction hub

> **Executor instructions**: This is a UI/data-shaping change, not a scoring
> change. Preserve all profile-link authorization and hidden-pick rules. Run
> each gate and update `plans/README.md` when complete.
>
> **Drift check (run first)**: `git diff --stat ba288a1..HEAD -- apps/web/src/app/me apps/web/src/app/predictions apps/web/src/components/dashboard/profile-dashboard.tsx apps/web/src/components/follows apps/web/src/lib/ewc-profile-sync.ts src/lib/ewcProfileStats.js src/lib/ewcPredictions.js src/db/ewcPredictions.js apps/web/src/lib/i18n.ts`

## Status

- **Execution**: DONE (2026-07-10)
- **Priority**: P2
- **Effort**: M-L
- **Risk**: MED
- **Depends on**: plan 078
- **Category**: direction
- **Planned at**: commit `ba288a1`, 2026-07-10

## Why this matters

`/me` is currently a prediction card followed by a separate notification and
follow center, while `/predictions` is only two static link cards. Users cannot
see which prediction round is open, how many game picks remain, or where to act
without translating Discord command instructions. A tabbed account workspace
and a live prediction-status summary can make the current task obvious without
building a second scoring system.

## Current state

- `apps/web/src/app/me/page.tsx:33-51` renders a title, sign-out action,
  `ProfileDashboard`, then `FollowCenter` as unrelated vertical sections.
- `apps/web/src/components/dashboard/profile-dashboard.tsx:239-334` nests
  prediction history under Showcase/Season/Weekly tabs but knows nothing about
  current open rounds.
- `apps/web/src/app/predictions/page.tsx:65-112` is a static page with profile
  and leaderboard cards only.
- `apps/web/src/lib/ewc-profile-sync.ts:57-79` shapes the authenticated payload
  with link and historical stats, but no current-round state.
- `src/lib/ewcPredictions.js:378-402` already defines the canonical effective
  week state, including partly-open per-game rounds. Reuse it.
- `src/commands/ewc_predict.js:342` has current-open-week selection behavior;
  extract shared, command-free logic rather than importing a Discord command
  into the web workspace.
- `src/lib/ewcProfileStats.js:173-204` protects other users' season picks.
  Own-profile access currently opts into hidden picks at
  `ewc-profile-sync.ts:70-73`; preserve both policies.
- Plan 078 provides a query-backed notification inbox and unread badge. Reuse
  it instead of creating another notification data flow.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Round tests | `node --test tests/ewcPickerEntry.test.mjs tests/ewcPredictionLifecycle.test.mjs` | all pass |
| Focused web tests | `npm --workspace @esports-community-bot/web run test -- src/test/profile-workspace-model.test.ts src/test/ewc-profile-api.test.ts` | all pass |
| Bot tests | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

## Suggested executor toolkit

- Invoke the `shadcn` skill. Use existing Base UI Tabs, Badge, Progress,
  Skeleton, Empty, and Card primitives; do not add a marketing hero.
- Use browser checks at 390x844, 768x1024, and 1440x900 in both locales.

## Scope

**In scope**:

- `src/lib/ewcPredictionRounds.js` (new shared selection/status helper) or an
  equivalent command-free shared module
- `src/commands/ewc_predict.js` only to consume the shared helper unchanged
- `apps/web/src/lib/ewc-profile-sync.ts`
- `apps/web/src/app/api/me/ewc/route.ts`
- `apps/web/src/app/me/page.tsx`
- `apps/web/src/app/predictions/page.tsx`
- `apps/web/src/components/dashboard/profile-dashboard.tsx`
- New account/profile workspace components under `apps/web/src/components/dashboard`
- Plan 078 notification/follow components only for composition props
- `apps/web/src/lib/i18n.ts`
- Focused bot and web tests

**Out of scope**:

- Submitting or editing picks on the website.
- Scoring, leaderboard rank SQL, Discord role-connection metadata.
- Public player/team profile pages.
- Changing Discord command UX beyond moving shared round selection logic.

## Steps

### Step 1: Extract canonical current-round selection

Move the deterministic selection used by `currentOpenWeek` into a pure/shared
module that accepts hydrated weeks and `now`. It must prefer currently open
rounds, choose the soonest closing when multiple are open, and use
`effectiveEwcWeekStatus` for per-game locks. Keep existing command tests green
and add missing ties/boundaries.

**Verify**: bot focused tests pass with no Discord client import in the shared module.

### Step 2: Extend the authenticated profile payload

Add a `currentRound` projection with only data needed by the viewer:

- id/key/label and effective status;
- open/locked/total games and close time;
- viewer pick count and remaining game keys;
- guild/season and a safe Discord guild URL.

Return null when no actionable round exists. Validate guild/season exactly as
the route does now. Do not expose another user's picks.

**Verify**: API tests cover no link, no round, fully open, partly locked,
complete picks, incomplete picks, and closed/scored rounds.

### Step 3: Build a URL-addressable account workspace

Use one primary tab/segmented navigation controlled by a validated `?tab=`:
Overview, Predictions, Following, Notifications, and Settings. Put profile
identity and compact season metrics above it; move sign-out to the account menu
instead of presenting it as the page's primary action.

Reuse plan 078's components. Preserve tab selection across locale switches and
browser back/forward. Invalid values fall back to Overview.

**Verify**: pure workspace-model tests cover valid/invalid tab parsing and
localized URLs; keyboard arrows and focus follow Base UI Tabs behavior.

### Step 4: Make the Predictions tab action-oriented

Show current-round status first, with stable progress dimensions and logical
status colors. Provide clear actions to open the Discord guild and view the
prediction leaderboard. Keep season picks and weekly history below, using an
Empty state rather than instructional paragraphs when absent.

Do not imply website pick submission. Do not reveal season picks publicly
before their existing visibility rule allows it.

**Verify**: all current-round states render without layout shift or overlap.

### Step 5: Upgrade `/predictions` into a live public summary

Reuse the same public-safe round status to show what is open, closing next, or
awaiting scoring. Keep two clear destinations: signed-in account/picks status
and public prediction leaderboard. The page must remain useful when no round is
open and when DB data is temporarily unavailable.

**Verify**: English/Arabic metadata and page states build; no private picks are
serialized into the public page.

### Step 6: Responsive and RTL acceptance

Check all tabs, long team names, status progress, empty states, refresh/unlink,
and notification counts on mobile/tablet/desktop in both languages. There must
be no nested cards, tab overflow, or fixed physical left/right assumptions.

## Done criteria

- [x] `/me` is one coherent, URL-addressable account workspace.
- [x] Current prediction status and remaining picks are visible.
- [x] `/predictions` reflects live round state instead of two static cards.
- [x] Notification/follow data is reused from plan 078.
- [x] Hidden-pick and profile-link authorization rules are unchanged.
- [x] All required repo checks pass.

## STOP conditions

- Shared round selection cannot be extracted without changing command behavior.
- The design starts accepting web pick writes; make that a separate high-risk plan.
- The current route no longer identifies a single Discord guild safely.

## Maintenance notes

Keep prediction state derivation in the shared round module. Future web pick
submission, if approved, must reuse the same lock checks and receive a separate
security/scoring review.
