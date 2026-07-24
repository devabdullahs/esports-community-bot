# Plan 143: Make every match a first-class destination

> **Executor instructions**: `/matches/[id]` is the canonical public destination
> even when rich provider statistics do not exist. Keep thin pages useful
> through matchup context, actions, and discussion; `has_details` controls the
> stats section only, never whether a match can be opened.
>
> **Drift check (run first)**:
> `git diff --stat d1b66e1..HEAD -- apps/web/src/app/matches apps/web/src/components/matches apps/web/src/components/tournaments/tournament-match-list.tsx apps/web/src/components/tournaments/bracket-view.tsx apps/web/src/components/live apps/web/src/lib/match-details.ts apps/web/src/lib/live-match-center.ts apps/web/src/lib/i18n.ts apps/web/src/test`

## Status

- **Priority**: P1
- **Effort**: M-L
- **Risk**: MED
- **Depends on**: 142 recommended; 141 optional
- **Category**: product/bug
- **Planned at**: commit `d1b66e1`, 2026-07-24

## Design thesis

Treat the match page as a match dossier: a compact scoreboard and action rail
first, game/map evidence second, community conversation last. Rich stats deepen
the destination; they do not create it.

The page should answer, in order:

1. Who is playing and what is the state/outcome?
2. When/where can I watch or follow it?
3. What happened in the maps/games?
4. What is the community saying?

## Why this matters

The route already renders a useful header, no-stats explanation, and durable
comments for any stored match. Tournament rows, bracket cards, and the live
center link to it only when `has_details` is true. Matches from unsupported
games, start.gg, or Liquipedia rows without a rich Match payload therefore have
valid discussion pages with no normal discovery path.

The rich page is also only partially localized. Player/table/stat headers and
the tabs accessible label remain hard-coded English, and the header still uses
literal `TBD`. The page model already includes an official stream, but the
header does not use it.

## Current state

- `apps/web/src/app/matches/[id]/page.tsx:124-137` renders a no-stats `Empty`
  and comments when details are absent.
- `apps/web/src/components/tournaments/tournament-match-list.tsx:190-199`
  returns no page link without details.
- `apps/web/src/lib/live-match-center.ts:54-80` creates `detailsHref` only for
  detail-capable rows.
- `apps/web/src/components/tournaments/bracket-view.tsx:88-100` sends thin
  matches back to an in-page anchor.
- `apps/web/src/lib/match-details.ts:80-95` already supplies status, schedule,
  official stream, tournament, and optional details.
- `apps/web/src/components/matches/match-header.tsx` does not render the stream,
  reminder, or co-stream action.
- `match-detail-tabs.tsx` uses raw `<details>` for map/game disclosure although
  shadcn `Accordion` is installed.
- Dota labels, player/agent/hero headings, accessible tab label, `TBD`, and
  several map labels are hard-coded English.
- Existing tests characterize the data adapter, but not the rendered
  `/matches/[id]` EN/AR states.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `npm --workspace @esports-community-bot/web run test -- match-details-model live-match-center bracket-view match-reminders match-comments` | all pass |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Native typecheck | `npm --workspace @esports-community-bot/web run typecheck:native` | exit 0 |
| Web build | `npm run web:build` | exit 0 |
| Browser journey | `npm run web:e2e -- critical-public-journeys.pw.ts` | match journeys pass in EN/AR |

## Scope

**In scope**:

- Canonical links from tournament rows, brackets, and `/live`.
- A useful header/action rail for matches with or without rich stats.
- Official watch, reminder, co-stream, tournament, and source affordances when
  already available from stored/trusted data.
- Complete EN/AR visible and accessible copy.
- shadcn composition for tabs, accordions, tables, badges, empty/error states.
- Render/component/browser tests for all page states.

**Out of scope**:

- Adding provider stat ingestion or direct source fetching.
- Changing the comments persistence/moderation model.
- SEO-indexing every thin match page; thin pages may remain `noindex`.
- Match lifecycle schema changes; plan 142 owns them.
- A new social/reaction system.

## Git workflow

- Branch: `codex/143-first-class-match-pages`
- Commit style: `feat(matches): make every match discoverable`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add rendered route-state coverage

Create fixtures for:

- scheduled, running, and finished matches;
- with and without rich details;
- Valorant and Dota details;
- official stream present/absent;
- reminder eligible/ineligible;
- co-streams present/absent;
- long/missing team names and logos;
- archived tournament match;
- EN and AR.

Render the route/component boundary rather than testing only the payload
adapter. Assert the header, actions, empty/detail section, comments target, and
metadata/robots behavior.

**Verify**: discovery and localization assertions fail against the current UI.

### Step 2: Make the match URL canonical across public projections

Replace detail-gated link fields with an unconditional `matchHref` for every
public stored match ID. Update:

- tournament upcoming/live/result rows;
- bracket cards;
- live-center cards;
- any shared fixture view model.

`has_details` remains as a capability flag for stats copy/iconography only.
Keep in-page match anchors as secondary "locate in tournament" links where
useful, not as the primary destination.

Use a single composed link pattern; never nest interactive controls. Preserve
existing stream/reminder buttons as separate actions with clear accessible
names.

**Verify**: one thin match from each entry surface opens `/matches/[id]`, and
rich-match links remain unchanged.

### Step 3: Recompose the header as the stable match scoreboard

Make `MatchHeader` useful without statistics:

- tournament breadcrumb/link and game/source context;
- localized lifecycle badge;
- scheduled time or final outcome;
- teams/logos, series score, and explicit scoreless winner when plan 142 exists;
- official Watch action from the already-sanitized model stream;
- reminder control while eligible;
- co-stream links only when already projected by the server;
- source attribution as a secondary trusted-host link, not a raw URL.

Use the plan 141 shared `TeamIdentity`, `SeriesScore`, and status components if
available; otherwise keep the extraction compatible so plan 141 can adopt it.
The scoreboard should be one coherent surface, not a grid of equal stat cards.

Do not show dead controls. Missing stream, reminder, or co-stream data should
remove that action without shifting the match identity unexpectedly.

### Step 4: Make details progressive and shadcn-native

Keep `Tabs` for major sections and replace raw map/game `<details>` with the
installed `Accordion`. Use `Table` for row data and preserve horizontal
scrolling at narrow widths. Compose controls according to the Base UI variant
in this repository; do not copy Radix-only APIs.

Use one view model per supported game so page components do not parse provider
payloads. Preserve game-standard acronyms such as KDA/ACS where community
recognition is stronger than translation, but localize the surrounding label
and accessible expansion name.

For absent details, use shadcn `Empty` to explain that the match page still
supports schedule/watch/discussion. Do not label the entire page empty.

### Step 5: Complete visible and accessible localization

Move every human-readable match label into typed locale copy, including:

- TBD and versus;
- Player, Agent, Hero;
- map/game headings;
- Gold, Towers, Barracks, Roshans;
- tab-list and accordion accessible names;
- no-stats explanation and action labels;
- result reason/status introduced by plan 142.

Keep EN/AR key parity compiler-checked. Scores and dates use existing locale
formatters. Check compact Arabic labels in narrow tables and use logical text
alignment.

### Step 6: Define loading, error, and SEO behavior

Keep route-level loading/error/not-found boundaries. A post-initial refresh
failure should retain existing data and expose retry if the page starts polling;
do not blank the discussion.

Preserve `noindex` for a deliberately thin page if desired, but do not use
`noindex` to remove internal navigation. Rich pages retain canonical metadata.
Archived matches remain readable while their tournament remains intentionally
public.

### Step 7: Validate accessibility and responsive hierarchy

At 320 CSS pixels:

- teams and score remain the first visible facts;
- actions wrap without page overflow;
- tables scroll inside named regions;
- accordion/tabs work with keyboard;
- long EN/AR names truncate with full accessible names;
- focus is visible and motion respects reduced-motion.

Add a browser journey from tournament -> thin match -> discussion and live
center -> rich match -> stats, in both locales.

### Step 8: Run all gates

Run focused/full tests, lint, native typecheck, build, and browser journeys.
Confirm no match page or test performs a provider call.

## Test plan

- Unconditional match href across tournament, bracket, and live center.
- Scheduled/running/finished route states with and without details.
- Official stream/reminder/co-stream action presence and absence.
- Valorant/Dota accordion/table keyboard behavior.
- Complete EN/AR copy and accessible names.
- Thin-page `noindex` plus internal discoverability.
- Mobile/RTL long-name and horizontal-table behavior.

## Done criteria

- [ ] Every public stored match has a normal route from its surrounding views.
- [ ] Missing rich stats never removes the match destination.
- [ ] Header context/actions remain useful on thin pages.
- [ ] All match UI and accessible labels are localized.
- [ ] Accordions, tabs, and tables use installed shadcn composition.
- [ ] Comments remain attached to the same match identity.
- [ ] EN/AR, RTL, keyboard, and mobile journeys pass.
- [ ] All repository gates pass.

## STOP conditions

- A proposed action needs a new provider/network request from the web process.
- A match ID cannot be proven guild-scoped/public through the existing route
  lookup.
- Linking thin matches exposes a page whose comments target is not the same
  canonical match identity.
- A component change would require replacing the configured Base UI/shadcn
  stack.

## Maintenance notes

Future detail providers should enrich the existing destination. They must not
create a parallel match URL or reintroduce `has_details` as a navigation gate.
