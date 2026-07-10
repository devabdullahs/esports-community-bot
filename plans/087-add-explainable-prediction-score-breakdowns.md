# Plan 087: Add explainable prediction score breakdowns

> **Executor instructions**: Preserve hidden-pick privacy and existing point
> totals. This plan projects already-stored score details; it must not invent a
> second scoring implementation in React or Discord rendering code.
>
> **Drift check (run first)**: `git diff --stat 2301227..HEAD -- src/lib/ewcPredictions.js src/jobs/ewcPredictions.js src/lib/ewcProfileStats.js src/commands/ewc_predict.js apps/web/src/lib/ewc-profile-sync.ts apps/web/src/components/dashboard/profile-dashboard.tsx apps/web/src/lib/i18n.ts tests/ewcProfileStats.test.mjs apps/web/src/test/ewc-sync.test.ts`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plan 082 (for explicit late-pick detail)
- **Category**: direction
- **Planned at**: commit `2301227`, 2026-07-10

## Why this matters

Scoring already stores per-game pick, placement, earned points, winner, and
bonus information, but member surfaces collapse it to one total and sometimes
one bonus. A member cannot tell whether a zero came from a missed pick, an
unmatched club name, a finish outside the top eight, or a late submission.
Showing one canonical, bounded explanation improves trust without changing any
score or exposing still-hidden picks.

## Current state

- `src/lib/ewcPredictions.js:242-270` creates rich per-game details; season
  details at lines 284-304 contain predicted/actual rank and points.
- `src/jobs/ewcPredictions.js:417-435` persists those details with each score.
- `src/lib/ewcProfileStats.js:225-237` projects only formatted picks and
  `bonus`, discarding placements, winners, and per-pick points.
- `apps/web/src/components/dashboard/profile-dashboard.tsx:393-413` renders
  week label, joined pick text, total score, and bonus only.
- `src/commands/ewc_predict.js:1094-1117` similarly summarizes recent weeks
  without an explanation path.
- Public leaderboard rows intentionally omit picks and Discord IDs. Do not add
  breakdowns there.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused bot tests | `node --test tests/ewcPredictionBreakdown.test.mjs tests/ewcPredictionScoring.test.mjs tests/ewcProfileStats.test.mjs` | all pass |
| Focused web tests | `npm --workspace @esports-community-bot/web run test -- src/test/ewc-sync.test.ts src/test/prediction-breakdown-model.test.ts` | all pass |
| Bot suite | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

## Suggested executor toolkit

- Invoke the `shadcn` skill if available. Use Base UI/shadcn Accordion or
  Collapsible, Badge, Separator, and Table primitives already present.

## Scope

**In scope**:

- A pure breakdown projector in `src/lib/ewcProfileStats.js` or a focused new
  `src/lib/ewcPredictionBreakdown.js`
- `src/commands/ewc_predict.js`
- `apps/web/src/lib/ewc-profile-sync.ts`
- `apps/web/src/components/dashboard/profile-dashboard.tsx`
- Prediction copy in `apps/web/src/lib/i18n.ts`
- Focused bot/web model tests

**Out of scope**:

- Changing score calculations, bonuses, or results fetching.
- Returning breakdowns from public leaderboard or public MCP endpoints.
- Revealing another member's unscored/unlocked picks.
- Building charts; the dataset is small and a compact table is clearer.

## Git workflow

- Branch: `advisor/087-prediction-score-breakdowns`
- Suggested commit: `feat: explain prediction score breakdowns`
- Do not push or open a PR unless requested.

## Steps

### Step 1: Define a bounded canonical breakdown DTO

Build a pure projector over stored `details_json` that returns only display
fields:

- weekly per-game: game/event, pick, matched club/participant, placement,
  points, winner, and status (`scored`, `missed`, `unmatched`, `late`);
- aggregate legacy week: pick, matched team, weekly rank/points, and bonus;
- season: predicted rank, matched team, actual rank, hit points, exact bonus,
  and total;
- summary total and bonus copied from the authoritative stored score/details.

Never recompute points from placements in the projector. Bound strings and row
counts to configured round sizes; tolerate malformed historical JSON with an
explicit unavailable state.

**Verify**: pure tests cover all modes, malformed details, missing picks,
unknown clubs, late picks from plan 082, and exact-rank season bonuses.

### Step 2: Enforce visibility centrally

Only expose a breakdown when its row is scored or its relevant picks/results
are already public under existing lock rules. The authenticated owner may see
their selected picks before lock, but there is no score breakdown before a
stored score exists. A public profile lookup must never reveal still-open picks.

Use the existing `weeklyPickVisible`/season visibility semantics as source of
truth; extract them to a command-free module if necessary rather than copying.

**Verify**: privacy tests serialize owner, other-member-before-lock, partially
locked, closed, and scored cases and search for hidden club names.

### Step 3: Add web score explanations

Extend the authenticated `/api/me/ewc` payload with bounded breakdown DTOs.
In weekly history, render each scored week as a compact expandable row with one
line per game and a total/bonus footer. Render season score detail similarly.
Use semantic labels and icons, not color alone; support Arabic RTL and long
game/team names without horizontal clipping.

Keep collapsed rows lightweight and do not nest cards inside cards.

**Verify**: model tests cover copy/status mapping; browser acceptance covers
mobile/desktop and English/Arabic.

### Step 4: Add an owner-gated Discord detail view

Add a `Details` action to `/ewc_predict profile` for scored recent weeks and the
season result. Use a select/button flow bound to the invoking user and target
profile. Render bounded ephemeral embeds/Components V2, splitting fields only
when Discord limits require it. Do not expose another member's hidden picks.

The display consumes the canonical projector; it must not calculate points.

**Verify**: component tests cover owner gating, selected week, malformed detail,
and Discord field-length limits.

### Step 5: Run all gates and reconcile totals

For fixtures in each scoring mode, assert breakdown row sums plus bonus equal
the stored total. A mismatch must render an integrity warning and fail tests;
do not silently rewrite stored scores.

## Test plan

- New pure projector tests use details fixtures already shaped by
  `tests/ewcPredictionScoring.test.mjs`.
- Extend profile API tests to prove no public/other-user leakage.
- Add Discord component parsing/owner tests without contacting Discord.
- Run all repository gates.

## Done criteria

- [ ] Members can explain every scored weekly and season total.
- [ ] The projector never reimplements scoring formulas.
- [ ] Missing, unmatched, late, and outside-top-eight outcomes are distinct.
- [ ] Hidden picks remain hidden on every other-member/public path.
- [ ] Discord and web consume the same DTO and show the same totals.
- [ ] All required repo checks pass.

## STOP conditions

- Existing stored detail rows cannot be distinguished safely by scoring mode.
- Exposing a requested breakdown would require loosening hidden-pick rules.
- Stored totals disagree with authoritative detail calculations in production;
  report aggregate counts/modes without member identifiers before proceeding.

## Maintenance notes

Any new scoring mode must extend the canonical projector and its malformed/
privacy tests in the same change. Do not let UI components read raw
`details_json` directly.

