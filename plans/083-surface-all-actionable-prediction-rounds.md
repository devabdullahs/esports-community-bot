# Plan 083: Surface every actionable prediction round

> **Executor instructions**: Follow each step and verification gate. Stop on a
> listed STOP condition rather than inventing a new state model. Update this
> plan's row in `plans/README.md` when complete unless a reviewer owns the index.
>
> **Drift check (run first)**: `git diff --stat 2301227..HEAD -- src/lib/ewcPredictionRounds.js src/lib/ewcPredictions.js apps/web/src/lib/public-prediction-status.ts apps/web/src/lib/ewc-profile-sync.ts apps/web/src/app/predictions/page.tsx apps/web/src/components/dashboard/profile-dashboard.tsx apps/web/src/test/ewc-sync.test.ts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `2301227`, 2026-07-10

## Why this matters

EWC events are assigned to the week in which they finish, while their picks
lock before the event starts. This legitimately creates overlapping open
rounds. The website currently projects only the soonest-closing round. In the
2026 production schedule, Week 3 and Week 4 overlap from July 19 to July 21;
Week 4's MLBB pick locks at the exact moment Week 3 stops being selected, so it
is never surfaced by the website while actionable.

## Current state

- `src/lib/ewcPredictionRounds.js:3-16` explicitly filters all open rounds but
  returns only index zero after sorting by close time.
- `apps/web/src/lib/public-prediction-status.ts:65-93` returns one `round` and
  selects one upcoming or awaiting round.
- `apps/web/src/lib/ewc-profile-sync.ts:99-136` returns one private
  `currentRound` with only aggregate counts.
- `apps/web/src/app/predictions/page.tsx:138-186` renders one public round card.
- `apps/web/src/components/dashboard/profile-dashboard.tsx:277-337` renders one
  authenticated round card.
- The Discord picker already acknowledges multiple rounds via the week switcher
  at `src/commands/ewc_predict.js:333-353`. Preserve that behavior.
- Production data checked during planning contains 25 games across seven weeks,
  with several overlapping open windows. No member IDs are required to test it.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Round tests | `node --test tests/ewcPickerEntry.test.mjs tests/ewcPredictionRounds.test.mjs` | all pass |
| Focused web tests | `npm --workspace @esports-community-bot/web run test -- src/test/ewc-sync.test.ts src/test/public-prediction-status.test.ts` | all pass |
| Bot suite | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

## Suggested executor toolkit

- Invoke the `shadcn` skill if available. Reuse the existing Base UI/shadcn
  Card, Badge, Progress, Accordion/Collapsible, and Empty primitives.
- Check 390x844, 768x1024, and 1440x900 in English and Arabic.

## Scope

**In scope**:

- `src/lib/ewcPredictionRounds.js`
- `tests/ewcPredictionRounds.test.mjs` (new) and focused picker tests
- `apps/web/src/lib/public-prediction-status.ts`
- `apps/web/src/lib/ewc-profile-sync.ts`
- `apps/web/src/app/predictions/page.tsx`
- `apps/web/src/components/dashboard/profile-dashboard.tsx`
- Prediction/profile copy in `apps/web/src/lib/i18n.ts`
- Focused web tests

**Out of scope**:

- Writing or editing picks on the website.
- Reminder delivery and announcement wording; plan 084 owns those.
- Scoring formulas, ranking SQL, and Discord role metadata.
- Changing which official week an event belongs to.

## Git workflow

- Branch: `advisor/083-actionable-prediction-rounds`
- Suggested commit: `fix: show every actionable prediction round`
- Do not push or open a PR unless requested.

## Steps

### Step 1: Define one shared actionable-round model

Extend `src/lib/ewcPredictionRounds.js` with a pure function that returns all
rounds in these buckets:

- actionable now: `open` or `partly open`, ordered by the earliest remaining
  per-game lock, then round close/key;
- upcoming: ordered by `open_at`;
- awaiting scoring: locked/closed but not scored, newest first.

Keep `selectCurrentOpenEwcWeek` as a compatibility wrapper that returns the
first actionable result so Discord behavior does not change unexpectedly.
Project `nextLockAt` from open games rather than `close_at` alone.

**Verify**: new pure tests cover no rounds, one round, overlapping rounds,
partly locked rounds, tied deadlines, and upcoming/awaiting ordering.

### Step 2: Shape public-safe round arrays

Change `getPublicPredictionStatus` to return `rounds` (all actionable rounds)
plus bounded upcoming/awaiting summaries. During migration, retain the existing
`round` field as `rounds[0] ?? fallback` so current callers and public MCP code
do not break in the same deployment.

Each public round may include game key, public game/event label, lock time, and
open/locked state. It must not include member picks or Discord IDs.

**Verify**: `public-prediction-status.test.ts` proves the July-style overlap is
fully represented and serialized fields are public-only.

### Step 3: Shape private completion for every actionable round

Replace the single-round internal helper in `ewc-profile-sync.ts` with an
`actionableRoundsForViewer` projection. For each round return:

- round id/key/label and effective state;
- all configured games with key, label/event, `lockAt`, and state;
- picked, open-unpicked, and locked-unpicked counts/keys;
- `nextLockAt`, total games, and overall round close;
- a safe Discord destination placeholder (plan 084 will make it actionable).

Keep `currentRound` as a temporary first-round alias and add
`actionableRounds`; document the compatibility field in the TypeScript type.
Do not return pick values through this progress projection.

**Verify**: API tests cover two overlapping rounds with different picks and
assert no club name/pick value is leaked in the progress object.

### Step 4: Render a prediction task list on both pages

On `/predictions`, show every open round with its next lock and game count.
Place upcoming/awaiting summaries below, using compact full-width sections
rather than nested cards. On `/me?tab=predictions`, show viewer progress for
every actionable round and distinguish open-unpicked from already missed picks.

Use stable responsive dimensions and logical CSS. Do not put page sections in
decorative cards or cards inside cards. Long event/team text must wrap without
moving controls.

**Verify**: browser acceptance at all required viewports/locales; no active
round is hidden behind an accordion by default when it contains an unpicked
game locking within 24 hours.

### Step 5: Preserve compatibility and run all gates

Update all internal callers/types/tests for `rounds`. Search for direct
`status.round` and `currentRound` consumers and either migrate them or confirm
the compatibility alias is intentional. Run every gate.

## Test plan

- Add a pure overlap fixture matching the critical shape: Week A closes at T;
  Week B opens before T and contains a game whose `lockAt === T`.
- Extend `apps/web/src/test/ewc-sync.test.ts` with two simultaneous rounds and
  per-viewer progress.
- Assert public and private projections do not contain raw pick values.
- Keep existing `currentOpenWeek` tests green.

## Done criteria

- [ ] Every actionable round is returned in deterministic urgency order.
- [ ] The production overlap shape cannot hide a game for its whole open window.
- [ ] Public data contains no member picks; private progress contains no pick values.
- [ ] Existing Discord default-week behavior remains compatible.
- [ ] English and Arabic pages render all states on mobile and desktop.
- [ ] All required repo checks pass.

## STOP conditions

- Supporting multiple rounds requires exposing hidden picks publicly.
- Existing public MCP consumers cannot tolerate an additive `rounds` field plus
  the retained `round` compatibility field.
- The live schedule no longer permits overlapping rounds because a newer,
  documented product decision changed event-to-week assignment.

## Maintenance notes

`selectCurrentOpenEwcWeek` is only a convenience default after this plan; new
web/member experiences must consume the full actionable-round list. Plan 088
must build its forms from the same ordering/model.

