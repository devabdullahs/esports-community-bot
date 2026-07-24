# Plan 141: Recompose tournaments as a competition board

> **Executor instructions**: This is an evolution of the shipped tournament
> experience, not a replacement dashboard. Reuse the configured shadcn Base
> Nova primitives, semantic tokens, Thmanyah Sans, and existing data/actions.
> Do not install a second component library or introduce provider calls.
>
> **Drift check (run first)**:
> `git diff --stat d1b66e1..HEAD -- apps/web/components.json apps/web/src/app/globals.css apps/web/src/app/tournaments apps/web/src/components/tournaments apps/web/src/lib/tournament-directory.ts apps/web/src/lib/i18n.ts apps/web/src/test/tournament-directory.test.ts apps/web/e2e/critical-public-journeys.pw.ts`

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: 140 recommended
- **Category**: product/design
- **Planned at**: commit `d1b66e1`, 2026-07-24

## Design thesis

Make tournaments read like a live competition board: the eye should move from
"what is live" to "what starts next" to "what has concluded" without decoding
a grid of equal cards and pills. Identity comes from tournament marks, teams,
scores, time, and source provenance; containers stay quiet.

The result should feel editorial and sports-specific, not like a generic SaaS
dashboard:

- one strong competition masthead;
- compact status rails and table-like fixtures;
- deliberate hierarchy rather than a card around every subsection;
- semantic live/upcoming/final states;
- restrained motion only for real live-state changes.

## Why this matters

The current directory is capable but visually flat and operationally
inconsistent. Search has no accessible name, selection is communicated only by
button styling, and option counts change units inside the same filter row.
Filter state is not shareable. The EWC view cannot continue into an EWC-filtered
archive, and the archive has no search or filters.

The 706-line directory and 856-line match-list components also duplicate team,
score, logo, badge, and empty-state patterns. That makes a visual improvement
hard to keep consistent across directory, detail, archive, bracket, live center,
and match pages.

## Current state

- `/tournaments` and `/tournaments/ewc` share
  `TournamentDirectory`; `/tournaments/archive` is a separate chronological
  12-card page.
- `apps/web/src/components/tournaments/tournament-directory.tsx:151-220`
  renders search and three custom button rows.
- Search has only placeholder text. Filter groups have no accessible names or
  selected-state semantics.
- "All games" counts unique games and "All sources" counts unique sources,
  while sibling values count tournaments.
- The `results` filter overlaps live/upcoming tournaments because it checks for
  any finished match rather than using the primary tournament state.
- Directory filters live only in React state; reload/share/back navigation does
  not preserve them.
- EWC directory intentionally omits an archive link even though the data helper
  already accepts `ewcOnly`.
- The configured shadcn project is Base Nova, uses Base UI, Lucide, semantic CSS
  variables, RSC, Tailwind 4, and RTL. `InputGroup`, `ToggleGroup`, `Combobox`,
  `Select`, `Badge`, `Card`, `Table`, `Empty`, `Alert`, `Skeleton`, and
  `Accordion` are already installed.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `npm --workspace @esports-community-bot/web run test -- tournament-directory tournaments-api bracket-view` | all pass |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Native typecheck | `npm --workspace @esports-community-bot/web run typecheck:native` | exit 0 |
| Web build | `npm run web:build` | exit 0 |
| Browser journey | `npm run web:e2e -- critical-public-journeys.pw.ts` | EN/AR desktop/mobile passes |

## Scope

**In scope**:

- `/tournaments`, `/tournaments/ewc`, `/tournaments/archive`, and shared
  tournament-detail presentation primitives.
- URL-backed status/game/source/search filters.
- Correct, mutually understandable option counts.
- A consistent competition status/team/score visual vocabulary.
- A direct EWC-to-EWC-archive path.
- Responsive, RTL, keyboard, loading, empty, and error states.
- Splitting oversized client components along stable presentation boundaries.

**Out of scope**:

- New provider data, standings rules, or match lifecycle values.
- Bracket algorithm changes; completed plan 106 remains authoritative.
- Result pagination mechanics; plan 140 owns them.
- Match-page content and localization; plan 143 owns them.
- Admin tournament management; plan 145 owns it.
- Replacing shadcn primitives or changing the global brand/font.

## Git workflow

- Branch: `codex/141-tournament-competition-board`
- Commit style: `feat(tournaments): recompose competition views`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Capture behavior and visual baselines

Add/extend fixtures covering:

- live, upcoming, result-only, idle, archived, and EWC tournaments;
- multiple games and sources;
- long Arabic and English tournament/team names;
- missing logos, TBD teams, scoreless results, and empty filters;
- 320, 768, and desktop widths in LTR and RTL.

Record screenshots for the current directory, EWC directory, archive, and one
detail page. These are comparison artifacts, not pixel-locking golden tests.

**Verify**: current filter semantics/counts are asserted before changing them.

### Step 2: Define shared competition presentation primitives

Extract thin domain-aware components, composed from shadcn rather than forked
UI primitives:

- `CompetitionStatusBadge` for live/upcoming/final/postponed/cancelled states;
- `TeamIdentity` for logo, name, TBD fallback, and winner emphasis;
- `SeriesScore` for score/result presentation;
- `TournamentIdentity` for mark, game/source, name, and dates;
- `FixtureRow` for the shared compact match anatomy.

Use semantic tokens only. A live badge should communicate activity, not error,
so do not use `destructive` as the generic live color. Do not use gradients as
decoration, turn every label into a pill, or create new shadow/radius systems.
Use `data-slot`/variants where the existing Base Nova components expect them.

Replace hard-coded `TBD` and `VS` with locale copy. Use Lucide icons through the
configured icon library and logical spacing/alignment for RTL.

**Verify**: render tests cover missing logo/name, winner/no score, both locales,
and status variants.

### Step 3: Make filter state semantic and URL-addressable

Define one pure filter-state parser/serializer for:

- primary status;
- game;
- source;
- search text;
- EWC-only mode where applicable.

Use one mutually exclusive primary state per tournament. "Results" must not
also count a live tournament merely because an earlier match finished. Preserve
unknown/idle behavior explicitly rather than silently dropping rows.

Write state to search parameters with replace/push behavior that supports
back/forward navigation. Omit default parameters. A copied URL must reproduce
the same directory, and invalid values must fall back safely.

All counts in a filter group must use the same unit: number of tournaments that
would remain after applying the other active dimensions.

**Verify**: pure tests cover round-trip serialization, invalid values,
cross-filter counts, and mutually exclusive status totals.

### Step 4: Compose the filter bar with installed shadcn primitives

Use:

- `InputGroup` with a visible or screen-reader `Label` for search;
- single-selection `ToggleGroup` for the small primary-status set;
- `Select` or `Combobox` for potentially long game/source lists;
- `Button` for clear/reset and archive navigation;
- `Badge` only for compact counts/status, not as a generic container.

Each group needs a programmatic name and selected state. Preserve horizontal
scroll only where necessary; the control bar should otherwise wrap without page
overflow. Do not manually reproduce component internals or nest buttons/links.

**Verify**: keyboard tests select every filter, expose the active option, clear
state, and retain focus through URL updates in EN/AR.

### Step 5: Recompose the directory hierarchy

Build the page in this order:

1. compact masthead with total/live/upcoming/result facts;
2. live competition rail when present;
3. filter/search toolbar;
4. upcoming/result directory;
5. archive continuation.

Use visual density intentionally:

- live items can be prominent;
- upcoming items should emphasize start time and matchup;
- concluded items should emphasize outcome;
- metadata recedes rather than competing with team names and score.

Use quiet separators and surface contrast before adding more cards. Replace
custom empty cards with shadcn `Empty`; use `Skeleton` only for real loading,
not SSR data already available. Keep follow/source actions in the same stable
place across card variants.

Split `TournamentDirectory` into a state/controller boundary plus focused
presentational sections. Do not create a prop-drilling tree; pass compact view
models.

### Step 6: Unify active, EWC, archive, and detail continuity

The EWC page must link to `/tournaments/archive?ewc=1`, and the archive must
accept the same game/source/search vocabulary with server-readable pagination.
Preserve filters across archive pages and publish canonical metadata that
excludes incidental pagination/search combinations where appropriate.

Give EWC mode distinctive competition copy/marking without forking the whole
directory. On detail pages, reuse the shared identity/status/fixture primitives
while keeping standings, bracket, follows, reminders, streams, and source health
behavior unchanged.

Do not regress archived tournament detail access.

### Step 7: Validate responsive, RTL, and motion behavior

At 320 CSS pixels:

- no page-level horizontal overflow;
- team names truncate without hiding score/time;
- filters remain operable;
- touch targets meet the existing component sizing;
- archive paging remains reachable.

In RTL, status/order meaning remains unchanged while layout uses logical
direction. Focus indicators must remain visible. Honor `prefers-reduced-motion`;
any live-state transition should be opacity/color only and not continuous
decorative animation.

### Step 8: Run all gates and compare the result

Run focused tests, full web tests, lint, native typecheck, build, and browser
journeys. Compare new screenshots against the baseline at all widths/locales and
record any deliberate behavior changes in the PR description.

## Test plan

- Filter parser/serializer and cross-filter count tests.
- Keyboard/accessible-name tests for search, toggle group, selects, and reset.
- Shared status/team/score primitive render tests.
- Active/EWC/archive filter continuity.
- Long-name, missing-logo, TBD, scoreless, empty, and error fixtures.
- EN/AR desktop, tablet, and 320-pixel browser screenshots.

## Done criteria

- [ ] The page has a clear live-to-upcoming-to-results hierarchy.
- [ ] Search and every filter have names and selected-state semantics.
- [ ] Filter counts consistently mean tournaments.
- [ ] Filter state is shareable and back/forward safe.
- [ ] Finished EWC tournaments are directly discoverable.
- [ ] Shared match/tournament anatomy is not duplicated across large files.
- [ ] The UI uses installed shadcn primitives and semantic tokens.
- [ ] EN/AR, RTL, keyboard, reduced-motion, and mobile checks pass.
- [ ] All repository gates pass.

## STOP conditions

- A design change requires inventing a new brand/font/theme without operator
  approval.
- A component rewrite changes the underlying match/bracket/follow/reminder
  behavior. Isolate and characterize that behavior first.
- A desired filter cannot be represented deterministically in URL state.
- The implementation would require provider access from a page or web route.

## Maintenance notes

Keep domain presentation in thin wrappers and generic interaction behavior in
the installed shadcn components. New tournament states should be added to the
shared status model once, then exercised in both locales and all surfaces.
