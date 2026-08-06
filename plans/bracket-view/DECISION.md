---
slug: decision
title: Real edges, declared placement, no measurement
approach: Render the persisted official-sheets draw graph (real, read edges) on an integer-placed CSS grid, with connectors as logical-property CSS elbows gated on real edges — never measured, never inferred.
stance: refactor
new_deps: none
risk: medium — the draw payload is verified against Black Ops 7 / Rainbow Six workbooks only; other games may parse into degenerate sections (mitigated by strict validation with automatic fallback to today's exact behaviour)
---

# Decision: merge of `fable.md` and `opus.md`

Two independent planners, same stance (refactor), incompatible on two axes. This
is the resolution and the plan of record. Read `fable.md` and `opus.md` for the
full reasoning behind each half; this file states what actually gets built and
why each half won where it won.

## The finding that decides the data question

Verified directly in the repo before merging, not taken from either plan:

- The `matches` table has **no `round` or `stage` column** (`scripts/postgres/schema.sql`,
  `src/db/index.js:26-55`).
- Every writer stores `name = "<A> vs <B>"` — liquipedia
  `src/services/liquipedia/parsers.js:335,437,499`, official sheets
  `src/jobs/officialEwcSheets.js:204` — and `MATCHUP_RE` in
  `tournament-brackets.ts` rejects exactly that shape.
- So `projectTournamentBracket` is starved for the headline EWC tournaments.
  `BracketView` is dormant UI for the games this work is *for*.
- Real feeder edges already exist and are already persisted:
  `src/services/officialEwcSheets/parsers.js:423` — "Edges come from the sheet
  too: a later slot literally reads 'Winner of UB 2.1'" — with `sourceA`/`sourceB`
  per slot, written to `tournament_overviews.payload_json.bracket` at
  `src/jobs/officialEwcSheets.js:725`.

This is why the data half goes to **fable**. Opus plans a genuinely elegant
layout over a data source that, for the tournaments in question, produces
nothing — and it says so itself in its own frontmatter: the lower-bracket column
offset is "a drawing convention inferred from round order, not a fact in the
data." With real edges on hand, that inference is unnecessary.

## The finding that decides the rendering question

Fable draws connectors as a measured SVG overlay: `useLayoutEffect`, offset
walking, `ResizeObserver`, one code path per direction. Opus deletes all four
hazards instead of handling them — connectors are CSS pseudo-elements on the
receiving grid cell, positioned in percentages of the cell with
`inset-inline-start` / `border-inline-start`:

- resize, zoom, font swap: percentages of the cell, nothing recomputes
- RTL: logical properties mirror under `dir="rtl"`, no second code path, no `x` negation
- scroll: elbows are in normal flow inside the scroller, so they scroll by definition
- testability: `data-connector` is a string in `renderToStaticMarkup` output

Opus's reasoning is right and general: *every* hazard the brief named is a
consequence of measuring, so don't measure. The rendering half goes to **opus**,
and `bracket-connectors.tsx` is not built.

## The synthesis (neither plan alone)

Opus gates a connector on a count heuristic — previous round in the same band
has exactly `2 × m` matches. That is inferred pairing, the thing fable's whole
design refuses. Fable has real edges but spends them on a measured overlay.

Combine them: **fable's edges decide whether a connector exists; opus's geometry
decides how it is drawn.** A cell is marked `data-connector="pair"` only when
all of these hold, checked server-side in the pure layout function:

1. the cell has exactly two incoming edges, and both are `declared` or `traced`
   (never positional),
2. both sources sit in the immediately preceding track of the same band, and
3. the two sources' row spans are exactly the two halves of this cell's span.

Otherwise no line — the slot renders an awaiting chip or nothing. Both rules
survive intact: never draw an inferred line, and never measure to draw a real
one.

## What is taken from where

| Concern | From | Resolution |
|---|---|---|
| Primary data source | fable | Persisted draw graph; label projection becomes the edge-less fallback through an adapter, so the view has one rendering path |
| Edge derivation | fable | `declared` (read from "Winner of X" cell text) + `traced` (a decided team's name literally appears in a later slot); ambiguity and absence both render nothing |
| Sections | fable | One sub-bracket per sheet section (`Group A`, `PLAYOFFS`), stacked — BO7 draws both groups with identical round titles, which a single merged bracket cannot express |
| Column axis, draw mode | fable | Track index = position of the round's **sheet column**; the sheet author already aligned UB and LB, so cross-band alignment is read, not invented |
| Column axis, fallback mode | opus | `upper 1..u`, `lower 2..l+1`, branchless trailing at `max(u, l+1)+1`. Inference, but it draws no lines and reads one column early at worst |
| Row axis | opus | `row = floor(i·TRACKS/m)+1`, `span = floor((i+1)·TRACKS/m) − floor(i·TRACKS/m)`. Replaces `flex-1` distribution: same visual result, declared rather than distributed, therefore assertable in SSR |
| Connectors | opus mechanism, fable gate | CSS pseudo-element elbows, logical properties, gated on real edges per the three conditions above |
| Card component | opus | Extract `bracket-match-card.tsx`; add `data-state`, `data-winner`, `border-inline-start` winner/live markers so nothing is signalled by colour alone |
| Scannability | opus | Fixed score column `--bracket-score-w: 2.25rem` so scores form one vertical rule per round; `data-density="compact"` when a band's `TRACKS > 8` |
| Round navigation | opus | Round rail above the scroller replacing the inert sticky heading; moves via `scrollIntoView({inline:"nearest"})` and **never** `scrollLeft` arithmetic (its sign and origin differ across engines in RTL) |
| Motion | opus | Exactly two: the live pulse and the existing follow lift/dim. Both `motion-reduce:` gated |
| Follow-a-team | mine, kept by both | Keep as shipped; add opus's combobox branch above 12 teams |
| Awaiting chips | fable | A declared source renders localized copy (`bracketAwaitingWinner("UB 1.1")`), not raw sheet English |
| Cross-band lines | both agree | Not drawn. Liquipedia and fandom don't either; chips plus follow-a-team tell the fall story |

## Conflict resolved explicitly

Opus lists `apps/web/src/lib/tournaments.ts` and
`tournament-match-list.tsx` as out of scope. Fable must modify both to thread
the `draw` payload to the client. **Fable wins** — the payload cannot reach the
view otherwise. Consequence to verify rather than assume during step 2: no
`route.ts` HTTP method is added or changed, so `api-authorization-policy.ts`
needs no new entry, and no route shape changes, so
`scripts/security/boundary-cases.json` fingerprints stay as they are. Never edit
that file to make a gate pass.

## Ordered steps

Gates, per `AGENTS.md`: `npm --workspace @esports-community-bot/web run lint` ·
`npm --workspace @esports-community-bot/web run test` ·
`npm run web:build` · `npm run security:boundary` (after the build) ·
`npm test` (bot suite, only if a `src/` or `scripts/` file changes).

1. **`apps/web/src/lib/tournament-draw.ts` + `src/test/tournament-draw.test.ts`.**
   Pure, server-safe: validate and gate on the attribution constant, sanitize
   every string with the existing `overviewText` discipline, bucket into
   sections, key slots, resolve declared and traced edges, join slots to match
   rows on the unordered normalized pair. No UI change.
2. **`apps/web/src/lib/bracket-layout.ts` + `src/test/bracket-layout.test.ts`.**
   Pure: draw or fallback model → columns, bands, per-cell `(row, span)`, and
   the `connector` flag under the three-condition gate. No React, no DOM.
3. **Thread `draw` through the payload.** `tournaments.ts` computes it from the
   already-fetched overview row and the same deduped match rows — no new query;
   `TournamentMatchesPayload` carries it. Nothing renders it yet.
4. **Restructure `BracketView`** onto the layout model with the fallback
   adapter, extracting `bracket-match-card.tsx`. The eight existing
   `bracket-view.test.tsx` tests are the migration contract and must pass
   **unmodified**.
5. **Render the draw**: sections, sheet-column tracks, awaiting chips, best-of
   chips, joins, new i18n keys in both locales.
6. **Connector CSS block** in `globals.css` (append only), plus the round rail,
   density, and state markers.
7. **Seed + final gates.** Extend `scripts/seed-dev.mjs` with a seeded
   two-group draw so `DB_PATH=<tmp> npm run seed:dev` gives a visual preview.

STOP conditions, do not improvise: the live or seeded `payload_json.bracket`
doesn't match the shape fable documents; preserving an existing
`bracket-view.test.tsx` assertion would require changing its meaning; a fix
appears to need an out-of-scope file (especially the sheets parser or job); a
step's verification fails twice.

## Not doing

Union of both plans' exclusions: no positional edge inference in fallback mode,
no cross-band lines, no ingest or schema change, no new dependency, no measured
placement, no pan/zoom or minimap, no `@testing-library/react`. Also not fixing
start.gg fallback coverage by ingesting `fullRoundText` — correct idea, wrong
layer, flag as a follow-up in the PR description.
