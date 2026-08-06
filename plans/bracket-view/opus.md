---
slug: opus
title: Compute placement, never measure geometry
approach: One pure function assigns every match an integer (column, row, span) on a shared grid; connectors are percentage-based CSS elbows on the receiving card, drawn only where the pairing is arithmetically certain.
stance: refactor
new_deps: none
risk: medium — the +1 lower-bracket column offset is a drawing convention inferred from round order, not a fact in the data
---

# Bracket view: place it with arithmetic, not with a ruler

> **Executor instructions**: Follow this plan step by step. Run the gates in
> "Commands and gates" at the end of every step and confirm the expected result
> before moving on. If anything in "STOP conditions" occurs, stop and report —
> do not improvise.
>
> **Planned at**: commit `b9648281`, 2026-08-06, branch `fix/bracket-round-alignment`.
>
> **Drift check (run first)**:
> `git diff --stat b9648281..HEAD -- apps/web/src/components/tournaments/bracket-view.tsx apps/web/src/lib/tournament-brackets.ts apps/web/src/test/bracket-view.test.tsx apps/web/src/lib/i18n.ts`
> If any of those changed, compare the excerpts in this plan against the live
> code before proceeding; on a mismatch, treat it as a STOP condition.

## Core idea

A bracket's geometry is arithmetic, not measurement: every match's column, row,
and row-span can be computed from the round list alone, server-side, in a pure
function — which means the layout is correct under resize, RTL, zoom and scroll
by construction rather than by a `ResizeObserver` keeping an SVG overlay in
sync. Connector elbows then need no coordinates at all, because a card that
spans exactly the rows of its two feeders can draw the join as percentages of
itself — and where the feeder count is not exactly double, the plan draws
nothing rather than guessing a line.

## Stance

**Refactor.** The recognition layer is right and stays; the layout model is
wrong and goes.

### What the current code gets right (keep all of it)

- `projectTournamentBracket` in `apps/web/src/lib/tournament-brackets.ts`
  refusing to draw. `GROUP_FORMAT_RE` rejects group/Swiss/pool/lobby labels,
  `isLobbySchedule` drops battle-royale lobby rows, `rounds.length < 2` and
  `numericRoundsLookLikeBracket` reject ambiguous numeric sequences
  (`tournament-brackets.ts:259-270`). Nothing in this plan touches those rules.
  A bracket view's worst failure is drawing a fake bracket for a points table,
  and this module already prevents it.
- Stacking upper / lower into separate bands instead of one long row of rounds.
  The instinct is correct; only the column arithmetic inside it is wrong.
- Accessibility instincts that are already there and must survive: a followed
  run is shown by lifting and dimming rather than by recolouring
  (`bracket-view.tsx:118-121`), team names are wrapped in `<bdi>`, the scroll
  region is focusable with an `aria-label`, and outcome text comes from
  `matchOutcomeLabel` rather than from colour.
- The card content itself: logo with initials fallback via `safeUrlOrUndefined`
  + `logoProxyUrl`, `tabular-nums` scores, the localized round-name mapping in
  `phaseLabel` / `roundLabel`, and the `/matches/[id]` link.

### What it gets wrong

1. **The grand final renders in the wrong place.** `BRANCH_BANDS = ["upper",
   "lower", null]` (`bracket-view.tsx:157`) puts every branchless round in a
   third band, and each band is a grid that packs from column 1. In a double
   elimination the grand final has `branch: null` (the label carries no "upper
   bracket"/"lower bracket"), so it lands alone in a third strip, in column 1,
   directly under Upper Bracket Round 1. The last match of the tournament draws
   at the start of the draw. The existing double-elim test fixture
   (`bracket-view.test.tsx:125-131`) has no grand final, so nothing catches it.
2. **Bands left-pack against a shared width.** `widest` is the largest band's
   round count and every band gets
   `repeat(${widest}, minmax(13rem, 1fr))` (`bracket-view.tsx:172, 246`), but
   rounds fill from column 1. A lower bracket with more rounds than the upper
   puts LB Round 1 under UB Round 1 and the upper final nowhere near the lower
   final. The columns line up numerically and lie temporally.
3. **`flex-1` proportional centring cannot express a half-drawn round.**
   `<div className="flex flex-1 items-center">` per match
   (`bracket-view.tsx:262`) divides a round's height evenly. That is exactly
   right for 4→2 and 2→2, and silently wrong for 3→2, which is what a
   partially-drawn round looks like — and half-drawn brackets are a named
   requirement. It is also a *runtime* property, so nothing about it can be
   asserted from an SSR string.
4. **The sticky round header is inert.** `<h4 className="sticky top-0 z-10 …
   backdrop-blur">` (`bracket-view.tsx:250`) sits inside
   `<div data-bracket-scroll="true" className="overflow-x-auto …">`
   (`bracket-view.tsx:229-233`). Per CSS overflow, a computed `visible` on one
   axis becomes `auto` when the other is not visible, so that wrapper is the
   nearest scrollport for both axes; it has content-driven height and never
   scrolls vertically, so `top: 0` never engages. The header renders as a plain
   heading while paying for a `backdrop-blur` compositing layer per round. The
   same `overflow-y: auto` also clips the `focus-visible` ring on cards at the
   top and bottom edges.
5. **`teamKey` is not a key.** `(value ?? "").trim().toLocaleLowerCase()`
   (`bracket-view.tsx:83-85`) is described as normalizing across sources but is
   not: "Team Falcons" and "Falcons" are two teams, so a followed run breaks at
   exactly the round where the spelling changes. A literal `"TBD"` or
   `"Winner of UB 2.1"` becomes a followable "team". Meanwhile `team_a_id` /
   `team_b_id` are already carried through `publicBracketMatch`
   (`tournament-brackets.ts:187-207`) and are ignored.
6. **One chip per team, unbounded.** The follow control emits a button per
   distinct competitor (`bracket-view.tsx:210-225`). A 32-team draw is 32 chips
   above the bracket — on a phone, several screens of chips before the bracket
   starts.
7. **No live state.** A running match is visually identical to a scheduled one;
   `shouldShowOutcomeLabel` deliberately returns `false` for `running`
   (`match-lifecycle.ts:70-84`), so nothing marks it. The "fast to read at a
   glance, clear live/finished states" goal is entirely unmet today.

None of that requires a blank file. The projection, the card body, the copy
block, and every `data-*` hook the tests key on survive. What changes is the
layer between them — which is a refactor, and calling it a rewrite would be
theatre.

### Migration of existing tests

All eight tests in `apps/web/src/test/bracket-view.test.tsx` are expected to
keep passing unmodified. Two of them constrain the design and the executor must
respect the constraints rather than edit the tests:

- `expect(html.match(/aria-pressed/g)?.length).toBe(4)` — the new round rail
  must therefore use `aria-current`, **never** `aria-pressed`.
- `expect(html).toContain("snap-x snap-mandatory")` — keep that exact class
  pair on the scroll wrapper and add `md:snap-none` after it, so the substring
  still matches.

`expect(html).toContain('data-bracket-columns="3"')` also keeps passing: the
attribute moves from each band to the scroll wrapper and its value becomes the
total column count, which for that single-band quarterfinals/semifinals/grand
final fixture is still 3.

## Layout and rendering approach

**CSS Grid with explicit `grid-column` / `grid-row` placement, computed
server-side.** Not flex, not absolute positioning, not an SVG overlay.

Why not SVG: an overlay needs real coordinates, which means measuring cards in
an effect, re-measuring on every resize and font swap, mirroring x for RTL,
keeping the overlay's transform in sync with the horizontal scroll — and none
of it can be asserted from `renderToStaticMarkup`. Every one of the four
hazards the brief names (resize, RTL, scroll, testability) is a consequence of
measuring. So: don't measure.

### Column axis (shared by every band)

Computed from round order and branch only. `u` = number of upper-branch rounds,
`l` = lower, `o` = branchless.

- Single-band draw (only one of upper/lower/branchless is non-empty): columns
  `1..n` in `bracket.rounds` order.
- Two branches present: upper rounds take columns `1..u`; lower rounds take
  columns `2..l+1`. The offset of one is the standard double-elimination
  timeline — the first lower round is fed by the first upper round, so it
  cannot be concurrent with it. It is derived from round *order*, which
  `projectTournamentBracket` already establishes via `sortOrder`; it needs no
  edges and it draws no lines, so a non-standard draw reads one column early
  rather than reads a falsehood.
- Branchless rounds when a branch exists (grand final, third-place match) take
  the trailing columns: `openStart = max(u, l + 1) + 1`, then
  `openStart .. openStart + o - 1`, ordered by the existing `sortOrder`
  (third-place `50_000` before grand-final `60_000`).
- `totalColumns` = the largest column assigned. Every band renders
  `gridTemplateColumns: repeat(totalColumns, …)` and every round carries its own
  `gridColumn`, so a short band no longer packs against column 1.

### Row axis (per band)

`TRACKS` = the largest match count among that band's rounds. For match index
`i` (0-based) in a round with `m` matches:

```
row  = Math.floor(i * TRACKS / m) + 1
span = Math.floor((i + 1) * TRACKS / m) - Math.floor(i * TRACKS / m)
```

Integer, gapless, non-overlapping, and exact for the 2:1 and 1:1 ratios a real
bracket produces. For 8 teams (4 / 2 / 1, `TRACKS = 4`) it yields spans
1 / 2 / 4 and the semifinal cell covers exactly the two quarterfinal rows that
feed it — the same visual result `flex-1` gives today, but declared rather than
distributed, and therefore assertable. For an odd round (3 feeding 2) it yields
rows 1(span 1), 2(span 2): still gapless, no overlap, no false pairing implied.

Track height: `gridAutoRows: minmax(var(--bracket-track), auto)` with
`--bracket-track: 2.75rem`; the cards' own `min-h` drives the real height.

### Connectors

Drawn as CSS pseudo-elements on the **receiving** card's grid cell, never as
overlay geometry. A cell is marked `data-connector="pair"` only when the round
in the column immediately before it, **in the same band**, has exactly `2 × m`
matches. Otherwise the attribute is absent and nothing is drawn.

Given `pair`, the two feeders each span exactly half of this cell's rows, so
their centres sit at 25% and 75% of this cell's own height. The elbow is
therefore three percentage-positioned rules on the cell:

```css
/* apps/web/src/app/globals.css — illustrative, not final copy */
[data-bracket-cell][data-connector="pair"]::before {
  content: ""; position: absolute;
  inset-inline-start: calc(var(--bracket-gutter) / -2);
  top: 25%; bottom: 25%;
  border-inline-start: 1px solid var(--color-border);
}
[data-bracket-cell][data-connector="pair"]::after {
  content: ""; position: absolute;
  inset-inline-start: calc(var(--bracket-gutter) / -2);
  top: 50%; width: calc(var(--bracket-gutter) / 2);
  border-block-start: 1px solid var(--color-border);
}
```

plus a matching forward stub on cells that feed a `pair` cell. Consequences,
which are the whole point:

- **Resize / zoom / font swap**: percentages of the cell; nothing recomputes.
- **RTL**: `inset-inline-start` and `border-inline-start` mirror automatically
  under `dir="rtl"`, which is already set on the section from
  `directionForLocale(locale)`. No second code path, no `x` negation.
- **Scroll**: the elbows are in normal flow inside the scrolling grid, so they
  scroll with the cards by definition.
- **Wrong lines**: structurally impossible. A line exists only where the count
  ratio is exactly 2:1 within one branch across adjacent columns; the code
  never consults team names to decide.
- Below `md` the connectors are hidden (`--bracket-gutter: 0`); at one column
  per viewport the gutter is off-screen anyway.

### Phone-first sizing and navigation

`gridTemplateColumns: repeat(N, minmax(min(72vw, 15rem), 1fr))` — one round
fills a phone screen and the whole bracket fits a desktop, from one rule. Keep
`snap-x snap-mandatory` (add `md:snap-none`) and `snap-start` per round, so a
phone swipe lands cleanly on a round.

Replace the inert sticky heading with a **round rail**: a horizontally
scrollable row of round buttons rendered *outside* (above) the scroll
container, marking the round currently in view with `aria-current="true"` and
moving the container when activated. The rail must scroll via
`element.scrollIntoView({ inline: "nearest", block: "nearest", behavior })` and
must **never** compute `scrollLeft` arithmetic — the sign and origin of
`scrollLeft` in RTL differ across engines, and that is the single most common
way an RTL horizontal scroller breaks. `behavior` is `"smooth"` unless
`window.matchMedia("(prefers-reduced-motion: reduce)").matches`.

### Live and finished states ("Apple Sports" scannability)

Every card gets `data-state="live" | "final" | "upcoming" | "paused"` derived
from `match.status` (`running` → live; `finished` → final; `postponed` /
`cancelled` → paused; else upcoming) and `data-winner="a" | "b"` when
`match.winner` is set.

- Live: a pulsing dot (`animate-pulse motion-reduce:animate-none`), an
  `border-inline-start-width: 2px` accent on the card (a *shape* change, not a
  colour-only cue), and the localized `matchStatusLabel("running", locale)`
  string inside the card's `aria-label` plus a visible label at `sm`+.
- Final: the winner's row keeps today's bold + primary score and additionally
  gets a `border-inline-start` marker, so the winner is never signalled by
  colour alone.
- Scannability: fix the score column with `--bracket-score-w: 2.25rem` so the
  scores form one vertical rule down each round. This is the cheapest and
  largest legibility win in the whole plan.
- Density: when a band's `TRACKS > 8`, cards render `data-density="compact"`
  (`min-h-14` instead of `min-h-20`, logo + name + score, no lifecycle badge),
  which keeps a 32-team first round around 56rem tall instead of 80rem.
- Exactly two motions ship: the live pulse, and the existing follow
  lift/dim (`transition-[opacity,transform]`, `motion-reduce:transition-none`).
  No entrance animation, no layout animation.

## File-by-file changes

**In scope — the only files to modify or create:**

| File | Change |
|---|---|
| `apps/web/src/lib/bracket-layout.ts` | **New.** Pure geometry: `TournamentBracket` → `BracketLayout` (columns, bands, per-cell row/span/connector). No React, no DOM. |
| `apps/web/src/lib/tournament-brackets.ts` | Add `competitorKey(name, id)` and `isPlaceholderCompetitor(name)`; export both. Nothing else changes — the refusal rules, `descriptorForLabel`, `publicBracketMatch` and the exported types stay byte-identical in behaviour. |
| `apps/web/src/components/tournaments/bracket-view.tsx` | Render from `BracketLayout`. **Delete** `BRANCH_BANDS`, `bandRounds`, `widest`, the local `teamKey`, the `sticky top-0 … backdrop-blur` heading classes, and the `flex flex-1 items-center` match wrapper. Add the round rail, `data-bracket-cell`, `data-connector`, `data-state`, and the >12-team combobox branch. |
| `apps/web/src/components/tournaments/bracket-match-card.tsx` | **New.** One match cell — logos, names, scores, state attributes, lifecycle badge, `/matches/[id]` link. Extracted verbatim from `BracketMatchCard` in `bracket-view.tsx` and then extended. |
| `apps/web/src/app/globals.css` | **New block only.** `--bracket-gutter`, `--bracket-track`, `--bracket-score-w`, and the `[data-connector="pair"]` pseudo-element rules. Append near the existing token blocks; change no existing declaration. |
| `apps/web/src/lib/i18n.ts` | Add to **both** `copy.en.tournaments` (near line 370–383) and `copy.ar.tournaments` (near line 1234–1247): `bracketRoundRail`, `bracketJumpToRound(label)`, `bracketLiveMatch`, `bracketFollowSearch`. Match the surrounding style — Arabic strings in the existing `\uXXXX` escaped form. |
| `apps/web/src/test/bracket-layout.test.ts` | **New.** Pure geometry tests. |
| `apps/web/src/test/bracket-view.test.tsx` | **Add** tests only. Do not weaken or delete any of the eight existing ones. |

**Out of scope — do not touch, even though they look related:**

- `apps/web/src/components/tournaments/tournament-match-list.tsx` — it already
  calls `projectTournamentBracket(bracketMatches)` at line 603 and renders
  `<BracketView bracket={bracket} locale={locale} />` at line 654. The props do
  not change, so this file does not change.
- `apps/web/src/lib/tournaments.ts` and anything under
  `apps/web/src/app/api/**` — no payload or route change is needed. **No
  `route.ts` HTTP method is added or changed, so the
  `apps/web/src/test/api-authorization-policy.ts` inventory required by
  `AGENTS.md` needs no entry.** Likewise no proxy rewrite or internal route
  changes, so `scripts/security/boundary-cases.json` fingerprints stay as they
  are — never edit that file to make a gate pass.
- Anything under `src/` (the bot). No ingest change is proposed.
- `projectTournamentBracket`'s refusal heuristics. Loosening them to make a
  test bracket render is out of scope and would regress `#355`.

## Data work

**The projection needs one addition and one only: a stable competitor key.**

Add to `apps/web/src/lib/tournament-brackets.ts`:

```ts
// Names are not identifiers: the same team is spelled differently between
// sources and rounds, and an undrawn slot is a sentence, not a competitor.
export function isPlaceholderCompetitor(value: string | null | undefined): boolean
export function competitorKey(name: string | null | undefined, id?: number | null): string | null
```

- `isPlaceholderCompetitor` returns true for empty/null, `TBD`, a bare `Q`,
  `Winner of …` / `Loser of …`, `Seed #<n>`, and `Group <X> #<n>`. Those exact
  shapes are what the ingest layer produces: `src/services/pandascore.js:133`,
  `src/services/startgg.js:301` and `src/services/lpdb.js:86` default an
  unresolved side to the literal `"TBD"`, and
  `src/services/officialEwcSheets/parsers.js:559` already recognises
  `/\b(?:winner|loser)\s+of\b|^(?:tbd|q)$/i` for the same reason.
- `competitorKey` returns `id != null ? \`id:${id}\`` for a resolved team id,
  otherwise `name:` + a normalization that mirrors the bot's
  `normalizeTeamName` (`src/lib/render.js:32-40`): lowercase, drop a leading
  `team `, drop parenthesised segments, strip everything outside `[a-z0-9]`.
  Returns `null` for a placeholder. **Reimplement it locally in the web
  module — do not import `@bot/lib/render.js`**, which would pull bot code into
  a `"use client"` bundle.

That fixes the follow control (one run per competitor, TBD never offered) and
costs nothing at ingest.

**Feeder edges: explicitly not derived, and here is the accounting.**

The brief is right that the match rows carry no edges, and this plan draws no
line that is not arithmetically certain (see "Connectors"), so it needs none.
But the executor should know two things, because a later reader will ask:

1. **Edges do exist for one source, and are currently discarded.**
   `parseBracketStructure` in
   `src/services/officialEwcSheets/parsers.js:448-556` reads the real draw off
   the Google Sheets Visualization tab — each slot carries
   `{ label, bracket, teamA, teamB, scoreA, scoreB, status, sourceA, sourceB }`
   where `sourceA/sourceB` are literal `{ outcome: "winner"|"loser", slot }`
   edges read from cells like `"Loser of UB 1.1"`. It is persisted with the
   tournament overview (`src/jobs/officialEwcSheets.js:717-730`,
   `OFFICIAL_PARSER_VERSION = 25`). It never reaches the browser:
   `publicTournamentOverview` in `apps/web/src/lib/tournaments.ts:377-399`
   whitelists `facts` and hard-returns `null` when no whitelisted fact
   survives, discarding everything else including `bracket`.
2. **Using it is a separate, larger, later piece of work, and it cannot
   replace this one.** It would need: a sanitised public projection of the draw
   (the payload is provider-shaped and currently unvalidated on the read path);
   a join from each slot to a `match.id` by normalized team pair plus round,
   because slots carry names and no ids, and every match card is a link;
   a new field on the tournament payload and its test coverage; and a
   reconciliation story for slots whose teams the schedule tab spells
   differently. And it covers `source = "official"` tournaments only —
   Liquipedia, PandaScore and start.gg draws would still be edgeless, so the
   edge-free layout in this plan has to exist regardless. Ship this first;
   treat the sheets graph as a follow-up that *adds* certainty to one source
   rather than as a prerequisite.

No ingest change, no migration, no effect on tournaments already in the
database.

## Ordered steps

### Commands and gates

Run from the repo root, `C:\Users\abdul\Documents\Esports Community Bot`.

| Purpose | Command | Expected |
|---|---|---|
| Focused tests | `npm --workspace @esports-community-bot/web run test -- bracket` | all pass (13 today, growing) |
| Web tests | `npm --workspace @esports-community-bot/web run test` | exit 0, all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web build | `npm run web:build` | exit 0 |
| Boundary gate | `npm run security:boundary` | exit 0 (run after the build) |
| Bot tests | `npm test` | exit 0 (should be untouched; run once at the end) |

Baseline confirmed at `b9648281`: `vitest run bracket` → 2 files, 13 tests,
all passing. Steps 1–5 must each end with the focused tests plus web lint;
step 6 runs the full list.

### Hard scope boundaries

Every step: `git status` must show changes only in the "In scope" table above.
If a fix appears to require a file outside it, that is a STOP condition.

### Step 1: Add the geometry module and its tests

Create `apps/web/src/lib/bracket-layout.ts` exporting:

```ts
export type BracketCell = {
  match: BracketRound["matches"][number];
  row: number;        // 1-based grid row
  span: number;       // grid row span
  connector: "pair" | null;
};
export type BracketLaidOutRound = { round: BracketRound; column: number; cells: BracketCell[] };
export type BracketBand = { branch: "upper" | "lower" | null; tracks: number; rounds: BracketLaidOutRound[] };
export type BracketLayout = { columns: number; bands: BracketBand[] };
export function layoutTournamentBracket(bracket: TournamentBracket): BracketLayout;
```

Implement exactly the column rule and the `row`/`span` formula in "Layout and
rendering approach". `connector` is `"pair"` when the round at `column - 1`
inside the same band has `2 × cells.length` matches, `null` otherwise. Bands
are emitted in `upper, lower, branchless` order and empty bands are dropped —
matching today's `BRANCH_BANDS` order so the existing band-ordering test
(`bracket-view.test.tsx:139-144`) still holds.

Create `apps/web/src/test/bracket-layout.test.ts` (no React; model the file
structure on the `match()` fixture helper at `bracket-view.test.tsx:11-25`)
covering:

- 8-team single elimination (4/2/1): columns 1/2/3, `tracks` 4, spans
  1/1/1/1, 2/2, 4; semifinal cells `connector: "pair"`; first round `null`.
- Double elimination with a grand final: upper `1..u`, lower `2..l+1`, grand
  final in the last column, `columns` equal to that last column.
- 3 matches feeding 2: rows `1 span 1` and `2 span 2`, both cells
  `connector: null`, and every track covered exactly once.
- 32 teams (16/8/4/2/1): `tracks` 16, spans 1/2/4/8/16.
- A band whose branchless round is the only band: columns `1..n`, no offset.

**Verify**: `npm --workspace @esports-community-bot/web run test -- bracket` →
all pass, including the new file; `npm --workspace @esports-community-bot/web run lint` → exit 0.

### Step 2: Render the view from the layout

Rewrite the body of `BracketView` in
`apps/web/src/components/tournaments/bracket-view.tsx` to call
`layoutTournamentBracket(bracket)` and render:

- the scroll wrapper keeping `data-bracket-scroll="true"`, `tabIndex={0}`,
  `aria-label={text.bracketScrollLabel}`, and the class substring
  `snap-x snap-mandatory` (append `md:snap-none`), now also carrying
  `data-bracket-columns={layout.columns}`;
- one `<div data-bracket-branch={band.branch ?? "open"}>` per band with
  `style={{ gridTemplateColumns: \`repeat(${layout.columns}, minmax(min(72vw, 15rem), 1fr))\` }}`;
- one `<section data-bracket-round={round.key}>` per round with
  `style={{ gridColumn: column }}` and `data-bracket-round-column={column}`;
- one cell per match with `style={{ gridRow: \`${row} / span ${span}\` }}` and
  `data-bracket-cell={\`${column}:${row}:${span}\`}`.

The `data-bracket-cell` attribute exists so SSR string tests can assert
geometry without depending on how React serialises inline styles — emit both.

Delete `BRANCH_BANDS`, `bandRounds`, `widest`, and the
`flex flex-1 items-center` wrapper. Remove `sticky top-0 z-10` and
`backdrop-blur` from the round heading (keep the heading, the border, and the
text classes). Move `BracketMatchCard` into
`apps/web/src/components/tournaments/bracket-match-card.tsx` unchanged and
import it.

**Verify**: `npm --workspace @esports-community-bot/web run test -- bracket` →
the eight existing `BracketView` tests still pass. Then add to
`bracket-view.test.tsx` a test that a fixture of
`Upper Bracket Round 1` / `Upper Bracket Final` / `Lower Bracket Round 1` /
`Lower Bracket Final` / `Grand Final` renders the grand final in the **last**
column, asserting `data-bracket-round-column="4"` on its section and that the
substring `data-bracket-round-column="1"` appears only for Upper Bracket Round
1. This is the regression test for defect 1 in "Stance".

### Step 3: Give competitors a stable key

Add `isPlaceholderCompetitor` and `competitorKey` to
`apps/web/src/lib/tournament-brackets.ts` as specified in "Data work". Replace
the local `teamKey` in `bracket-view.tsx` with `competitorKey(name, id)`,
passing `match.team_a_id` / `match.team_b_id`, and skip any side whose key is
`null` when building the follow list and when matching `data-bracket-path`.

**Verify**: `npm --workspace @esports-community-bot/web run test -- bracket`,
plus new tests in `bracket-view.test.tsx` asserting that (a) a fixture whose
`team_b` is the literal `"TBD"` produces no chip for it, and (b) a fixture with
`team_a: "Team Falcons"` in one round and `team_a: "Falcons"` in another offers
one chip, not two. The existing `aria-pressed` count test
(`bracket-view.test.tsx:100`) must still report 4.

### Step 4: Draw the certain connectors

Add the `--bracket-gutter` / `--bracket-track` / `--bracket-score-w` custom
properties and the `[data-connector="pair"]` pseudo-element rules to
`apps/web/src/app/globals.css`, appended as a new block; change no existing
declaration. Set `--bracket-gutter: 0` by default and a real value at
`min-width: 48rem`, so connectors only appear once more than one column is on
screen. Emit `data-connector="pair"` on the cell (and a `data-connector-feeds`
marker on the feeding round's cells for the forward stub) from
`bracket-view.tsx`, straight from `cell.connector`.

**Verify**: `npm --workspace @esports-community-bot/web run test -- bracket`,
plus a new test asserting `data-connector="pair"` appears in a 4/2/1 fixture
and does **not** appear anywhere in a 3/2 fixture. Then
`npm --workspace @esports-community-bot/web run lint` → exit 0.

### Step 5: Live states, the round rail, and the large-draw controls

- `data-state` / `data-winner` / `data-density` on the card, per "Live and
  finished states".
- The round rail above the scroll container: a `<nav aria-label={text.bracketRoundRail}>`
  of `<button type="button" aria-current={…}>` — **`aria-current`, never
  `aria-pressed`** — each calling `scrollIntoView({ inline: "nearest", block: "nearest", behavior })`
  on a ref'd round section, with `behavior` downgraded to `"auto"` under
  `prefers-reduced-motion: reduce`.
- When the follow list exceeds 12 competitors, render `Combobox` from
  `@/components/ui/combobox` (already a dependency — `cmdk` and
  `apps/web/src/components/ui/combobox.tsx` both exist) instead of the chip
  wall. At 12 or fewer, keep the chips exactly as they are today.
- Add the four new copy keys to **both** locales in `apps/web/src/lib/i18n.ts`.

**Verify**: `npm --workspace @esports-community-bot/web run test -- bracket`,
plus new tests asserting `data-state="live"` for a `status: "running"` fixture,
that the rendered HTML contains `aria-current` and that
`html.match(/aria-pressed/g)?.length` is still 4 for the four-team fixture, and
that an `ar` render contains the new Arabic strings.

### Step 6: Full gate pass

Run every command in the gates table, in order. Fix only what they report.

**Verify**: all six commands exit 0.

### STOP conditions

Stop and report; do not improvise, and do not edit a gate to make it pass.

- Any of the eight pre-existing tests in `bracket-view.test.tsx` fails and the
  fix would require changing the test's assertion rather than the component.
- `git status` shows a modified file outside the "In scope" table.
- `npm run security:boundary` fails. It probes route/proxy behaviour and this
  change touches no route; a failure means either the environment lacks a
  prerequisite or something unexpected shifted. Report it — never edit
  `scripts/security/boundary-cases.json`.
- The assumption "a double-elimination lower bracket's first round is fed by
  the upper bracket's first round" turns out to be false for a real fixture in
  the repo, i.e. a lower band has *more* rounds than `2 × (upper - 1)`.
- You find yourself wanting a team-name comparison to decide whether to draw a
  connector. That is the one thing this plan forbids; report instead.

## Test plan

Everything this design needs is assertable from `renderToStaticMarkup` output
plus plain function calls. **No new test infrastructure is required** — no
`@testing-library/react`, no jsdom (`vitest.config.ts` sets
`environment: "node"`; only `push-notification-settings.test.tsx` opts into
jsdom via a docblock, and this plan does not), no Playwright, no snapshot
files. That is a direct consequence of computing geometry instead of measuring
it: if the layout needed a DOM to be correct, it would need a DOM to be tested.

**`apps/web/src/test/bracket-layout.test.ts` (new, pure)** — the five cases in
step 1. These are the load-bearing tests: they pin the arithmetic that the
component merely prints.

**`apps/web/src/test/bracket-view.test.tsx` (extend)** — additions only:

| Behaviour | Assertion |
|---|---|
| Grand final draws last | `data-bracket-round-column="4"` on the grand-final section in a two-branch fixture |
| Cells declare their geometry | `data-bracket-cell="2:1:2"` present in a 4/2/1 fixture |
| Certain connectors only | `data-connector="pair"` present in 4/2/1, absent in 3/2 |
| Live state is marked | `data-state="live"` for `status: "running"` |
| Winner is not colour-only | `data-winner="b"` for a `winner_side: "team2"` finished match |
| Placeholders are not competitors | no chip for a literal `"TBD"` team |
| A run survives a respelling | one chip for `"Team Falcons"` + `"Falcons"` |
| Rail does not disturb the follow control | `aria-current` present **and** `aria-pressed` count still 4 |
| RTL needs no separate geometry | render the same fixture at `locale="ar"`; assert `dir="rtl"` **and** that the identical `data-bracket-cell` / `data-bracket-round-column` values appear as in the `en` render |

That last row is the one worth writing carefully. It is the proof that the
layout is direction-agnostic: the numbers are the same and the browser mirrors
them, which is exactly the property an SVG overlay would not have.

**What SSR cannot cover**: whether the connector's 25%/75% endpoints visually
land on the feeder cards' centres. That is a rendering property, not a markup
property. It is guaranteed by the row-span arithmetic that `bracket-layout.test.ts`
pins, and should be eyeballed once during review at `md` and `lg` widths in
both locales. If the repo's optional Playwright run (`npm run web:e2e`) is
already green in your environment, a screenshot of a double-elimination
tournament page is a reasonable extra — but it is **not** a required gate and
must not block this work.

## Failure modes

**Half-drawn bracket.** Note the real shape first: matches with *both* sides
TBD are dropped at ingest (`src/services/startgg.js:303`,
`src/services/lpdb.js:134`, `src/services/liquipedia/fetchers.js:140`), so an
undrawn later round is usually *absent* rather than present-and-empty. The
column axis is built from the rounds that exist, so the bracket renders short
rather than gappy — the last column is the last known round, which may not be
the grand final. Where a round is *partially* drawn (3 of 4 matches), the row
formula still tiles the band without gaps or overlap, and the following round's
count is no longer double, so `connector` is `null` and no line is drawn. A
card with one TBD side renders the localized `text.tbd` label, no logo,
`data-state="upcoming"`, and contributes no chip.

**32 teams.** Five rounds, `TRACKS = 16`, `data-density="compact"` (the
`TRACKS > 8` rule) so the band is roughly 56rem tall rather than 80rem. Width
is `5 × min(72vw, 15rem)`; on a phone that is five swipes, each landing on one
round via scroll-snap, with the rail giving the current position. The follow
control crosses the 12-competitor threshold and becomes a combobox, so the
chip wall never happens. This is the shape most likely to feel heavy; the
mitigation is density and the rail, not truncation — a bracket that hides
matches is not a bracket.

**One round.** `projectTournamentBracket` returns `null` at
`tournament-brackets.ts:259` (`rounds.length < 2`), `tournament-match-list.tsx:652`
renders no `BracketView`, and the plain match list is used. Unchanged by this
plan and covered by the existing test at `bracket-view.test.tsx:209-222`.

**Three-band draw (upper + lower + finals).** Upper takes `1..u`, lower
`2..l+1`, and the finals band takes the trailing columns — a third-place match
then a grand final, stacked in the last column in `sortOrder`. Because the
bands are separate stacked grids, the grand final sits *below* both branches
rather than vertically between them the way Liquipedia draws it. That is an
accepted difference, stated here so nobody reports it as a bug: rightmost still
reads as last, which is the property that matters.

**Arabic.** The geometry is identical; `dir="rtl"` on the section (already set
from `directionForLocale`) makes column 1 the rightmost, so rounds progress
right-to-left as they should. Connectors mirror because they use
`inset-inline-start` / `border-inline-start` only. `<bdi>` continues to keep
Latin team names from reordering inside RTL text. The one genuine hazard is the
rail: `scrollLeft` in RTL is negative in some engines and inverted in others,
which is why the rail is specified to use `scrollIntoView` exclusively. Round
names come from `phaseLabel` / `roundLabel`, which already resolve through the
`copy[locale].tournaments` block; the four new keys must be added to both
locales in the same change, per `AGENTS.md`.

## Not doing

- **No SVG connector overlay.** It buys curved lines and costs measurement,
  which costs a resize observer, an RTL mirror, scroll synchronisation, and
  testability. Straight CSS elbows read as a bracket; the reference brackets
  (Liquipedia, traditional draws) use straight elbows too.
- **No feeder edges inferred from team names.** "Falcons lost UB R1 and Falcons
  appear in LB R1, therefore an edge" is wrong the moment two matches in a
  round involve the same reseeded team, and a wrong line is worse than no line
  because a bracket's lines are the part readers trust most. The 2:1 count rule
  draws only what the round shape guarantees.
- **No 1:1 "carry" lines.** A lower-bracket minor round has the same match
  count as the round before it, and a straight line from match *k* to match *k*
  would assert a seeding relationship the data does not contain. Those columns
  stay visually joined by shared row alignment and the round headings, not by a
  fabricated line.
- **Not consuming the official-sheets draw graph yet.** Costed in "Data work".
  It covers one of four sources, needs a sanitised public projection and a
  slot→match-id join, and cannot remove the need for the edge-free layout. It
  is the right *next* piece of work, not this one.
- **No new dependencies.** `react-brackets` and
  `@g-loot/react-tournament-brackets` are both roughly 30–45 kB gzipped, both
  assume LTR, both want their own match shape, and neither would survive the
  TBD/half-drawn cases this data actually produces. The layout here is under a
  hundred lines of arithmetic.
- **No zoom, pan, minimap, or fullscreen bracket.** Scroll-snap plus the round
  rail is the phone answer; a pan-zoom canvas is a desktop toy that breaks
  keyboard reachability.
- **No change to what counts as a bracket.** `projectTournamentBracket`'s
  refusals were tuned against live workbooks as recently as `b4c573c1`
  ("stop reading a points grid as a bracket"). Widening them to show more
  brackets would re-introduce fake brackets for battle-royale events.
