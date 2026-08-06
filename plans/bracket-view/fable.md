---
slug: fable
title: Draw the sheet's persisted graph
approach: Render the already-persisted official-sheets draw graph (real, read edges) as the primary bracket source; never draw an inferred connector; keep the label projection as the edge-less fallback.
stance: refactor
new_deps: none
risk: medium — the draw payload has only been verified against Black Ops 7 / Rainbow Six workbooks; other games' sheets may parse into degenerate sections (mitigated by strict validation + automatic fallback to today's behaviour)
---

> Planned at commit `b9648281` (branch `fix/bracket-round-alignment`), 2026-08-06.
> Executor drift check: `git diff --stat b9648281..HEAD -- apps/web/src/components/tournaments/bracket-view.tsx apps/web/src/lib/tournament-brackets.ts apps/web/src/lib/tournaments.ts apps/web/src/test/bracket-view.test.tsx apps/web/src/lib/i18n.ts` — if any in-scope file changed, compare the "Current state" excerpts below against live code before proceeding; on a mismatch, STOP and report.

## Core idea

The bracket's shape should come from the one place that actually knows it — the persisted official-sheets draw graph (`tournament_overviews.payload_json.bracket`), whose edges are *read* off the sheet ("Winner of UB 2.1", "Loser of UB 1.1"), never computed from bracket arithmetic. Everything else follows from one rule: **a connector line renders only when its edge was read or is name-complete; an unknown edge renders as a labelled "awaiting" chip, never as a guessed line.**

## Stance

**Refactor.** The evidence, from recon:

- **What the current code gets right.** `projectTournamentBracket` (`apps/web/src/lib/tournament-brackets.ts`) is a careful, well-tested refusal machine: it declines groups/Swiss/lobbies/ambiguous numeric sequences rather than drawing a fake bracket. The view's mechanics are sound: stacked upper/lower bands, shared `gridTemplateColumns: repeat(widest, minmax(13rem,1fr))` so columns align across bands, per-match `flex-1` equal-share so a round centres against the pair feeding it with zero measured geometry, horizontal scroll + snap, RTL via `dir={directionForLocale(locale)}`, and a follow-a-team control keyed on normalized names. All of that survives.
- **What it gets wrong — and it is a data problem, not a CSS problem.** The projection is fed round *labels*, and in production those labels barely exist. The `matches` table has **no round column** (`src/db/index.js:26-55`); the web derives `round` from `name`/`external_id` via `bracketRoundFromStoredMatch` (`apps/web/src/lib/tournaments.ts:303`). But every provider stores `name = "A vs B"` (liquipedia `src/services/liquipedia/parsers.js:335,437,499`; start.gg `src/services/startgg.js:315`; official sheets `src/jobs/officialEwcSheets.js:204`), which `MATCHUP_RE` rejects, and official/start.gg external ids are opaque hashes (`officialEwcSheets.js:162-170`, `sgg:<setId>`). Only liquipedia match-page slugs occasionally yield "Round N" tokens — which the projection then refuses as ambiguous numerics unless counts halve. **The headline EWC tournaments (BO7, Overwatch, R6, Tekken, PUBGM — all `source: official`) can never project a bracket today.** The component is dormant UI shipped ahead of its data.
- **The missing piece already exists.** PRs #353–#355 (commits `c37e9203`, `cd2f2b03`, `b4c573c1`, merged 2026-08-06) added `parseBracketStructure` (`src/services/officialEwcSheets/parsers.js:448-556`): sections ("Group A", "PLAYOFFS"), rounds-as-columns with titles and best-of, slots with teams/scores/status, and — decisive — `sourceA`/`sourceB` edges parsed from literal "Winner/Loser of X" cell text. It is persisted whole in `tournament_overviews.payload_json.bracket` by `upsertOfficialTournamentOverview` (`src/jobs/officialEwcSheets.js:718-730`), and `OFFICIAL_PARSER_VERSION` is already 25, so live workbooks re-read and persist it without further bot work. The web already loads this row in `getTournamentMatches` (`apps/web/src/lib/tournaments.ts:624`) and currently throws the `bracket` field away (`publicTournamentOverview` whitelists facts only). Commit `b4c573c1`'s message says it plainly: "Nothing renders the draw yet."

So: not keep-and-extend (extending label parsing cannot conjure sections or edges that were never stored), and not rewrite (the projection module, its tests, the band/column/centring/follow mechanics, and the SSR test harness are all correct and reusable). Refactor: restructure `BracketView` around a unified section/round/slot model that **both** sources project into — the sheets draw (with edges) as the primary, the label projection (edge-less) adapted into the same model as the fallback — and add one new server-side projection module. All eight existing `bracket-view.test.tsx` tests and all five `tournament-brackets.test.ts` tests keep passing; the only observable fallback-mode change is deliberate (grand-final column joins the upper band instead of forming a third band, which no existing test asserts).

## Layout and rendering approach

**CSS grid for structure, flex for centring, one measured SVG overlay per band for connectors. No absolute positioning of cards, no canvas, no library.**

1. **Sections.** The draw renders one sub-bracket per section (`Group A`, `Group B`, `PLAY-INS`, `PLAYOFFS`), stacked vertically with an `h3` heading each — this is how Liquipedia and cod-esports.fandom present group draws, and it fixes what a single merged bracket cannot express (BO7 draws both groups' quarterfinals with identical round titles). Fallback mode is one anonymous section.
2. **Bands within a section.** If the section has upper or lower rounds: upper band = upper + final/other rounds (grand final and third-place columns converge at the right of the upper band — no more single-match third band), lower band = lower rounds. Otherwise one band. Band membership comes from the graph's `bracket` kind per round in draw mode, `branch` in fallback mode.
3. **Columns.** Per section, one shared `gridTemplateColumns: repeat(trackCount, minmax(13rem, 1fr))` across its bands. In draw mode, track index = position of the round's *sheet column* in the sorted unique column list of the section — the sheet author already drew UB and LB rounds to line up, so cross-band alignment is read, not invented (rounds carry `column` from the parser; `gridColumnStart` places them, allowing gaps). In fallback mode, tracks are sequential per band exactly as today (`widest` = max rounds per band). `dir="rtl"` flips the grid for Arabic automatically.
4. **Vertical centring.** Keep the current mechanism verbatim: each round is a flex column, each slot wrapper `flex flex-1 items-center`. A round with half as many slots centres each against its feeder pair with no measurement. (Positioning each slot at the measured average of its feeders is deliberately not done — see Not doing.)
5. **Connectors.** A client-only `<BracketConnectors>` renders one absolutely-positioned, `aria-hidden`, `pointer-events-none` SVG per band, inside the band wrapper (`position: relative`), which itself lives inside the existing horizontal scroll container — so lines scroll with content and no scroll listener exists. Geometry:
   - Each slot card carries `data-bracket-slot="<section>/<slotKey>"`. Edges arrive as resolved `{ from, to, outcome }` pairs (computed server-side, see Data work); only **within-band** edges draw (loser drops and LB-final→grand-final cross-band edges are conveyed by chips, matching the reference sites, which do not draw drop lines).
   - In a `useLayoutEffect`, walk each edge's two cards, accumulate `offsetTop/offsetLeft` up to the band wrapper, and emit an elbow path `M x1 y1 H xm V y2 H x2` (1.5px, `className="stroke-border"`; edges on a followed team's run get `stroke-primary`). The facing edges are chosen by comparing x-centres — draw from the source card's side nearer the target to the target's nearer side — which makes the geometry direction-agnostic: **RTL needs no special casing because offsets are measured from the real (already-flipped) layout.**
   - One `ResizeObserver` on the band wrapper recomputes on resize, font swap, and column growth. Server render and first client render return `null` (no hydration mismatch); lines appear after hydration as progressive enhancement. Static lines render regardless of `prefers-reduced-motion`; only animated affordances (live pulse via `motion-safe:animate-pulse`, opacity transitions) are motion-gated.
6. **Slot cards.** Superset of today's `BracketMatchCard`: two team lines with logo/`<bdi>`/score, winner in bold + `text-primary` (never colour alone), lifecycle badge via `matchOutcomeLabel`/`shouldShowOutcomeLabel`, wrapped in a `Link` to `/matches/<id>` **only when the slot joined a match row**; unjoined slots render as a non-link `div` with the same look (no dead links). New: a best-of chip (`Bo5`) when the round carries one, a `motion-safe:animate-pulse` primary dot for `running`, and "awaiting" chips for placeholder sides — a declared source renders localized copy (`text.bracketAwaitingWinner("UB 1.1")` → "Winner of UB 1.1" / "الفائز من UB 1.1") instead of raw sheet English; `TBD`/`Q`/unrecognized text renders as the localized TBD or the raw string in `<bdi>`, length-capped.
7. **Phone-first.** The existing scroll container (`overflow-x-auto`, `snap-x snap-mandatory`, `tabIndex=0`, `aria-label`, sticky round headers) is retained unchanged — columns snap one at a time on a phone; sections stack so each group is a separate, narrow story. Nothing new is required to be measured for SSR, so mobile first paint is complete and interactive without JS.
8. **Accessibility.** Cards keyboard-reachable (links), `aria-label` extended to `"<round>: <A> vs <B>"`, follow buttons keep `aria-pressed`, section/band/round headings are `h3`/`h4`, connector SVGs `aria-hidden` (the same information exists as chips and labels), winner conveyed by bold + score.

## File-by-file changes

Modified (in scope — the only files the executor may touch):

- `apps/web/src/lib/tournament-draw.ts` — **new.** Server-safe pure module: types (`TournamentDraw`, `DrawSection`, `DrawRound`, `DrawSlot`, `DrawEdge`), `projectTournamentDraw(overviewRow, matchRows)` (validate + sanitize + join + resolve edges), and `drawFromLabelProjection(bracket: TournamentBracket)` adapter. One line: turns the persisted graph and the legacy projection into the single model the view renders.
- `apps/web/src/lib/tournaments.ts` — add `draw: TournamentDraw | null` to `TournamentMatches`; compute it in `getTournamentMatches` from the already-fetched `rawOverview` + the same deduped match rows (`projectTournamentDraw(rawOverview, [...running, ...scheduled, ...postponed, ...finishedAll, ...cancelled])`). No new queries.
- `apps/web/src/components/tournaments/tournament-match-list.tsx` — add `draw` to `TournamentMatchesPayload`; render `<BracketView model={data.draw ?? adapted label projection} …>`; the existing `mergeBracketMatchSnapshot` path stays for fallback mode, and in draw mode the refetched payload's `draw` simply replaces the old one whole.
- `apps/web/src/components/tournaments/bracket-view.tsx` — restructured around sections/bands/slots as described; keeps (verbatim where possible) `TeamLogo`, `Score`, `teamKey`, the follow control, the scroll container, the sticky headers, and every `data-bracket-*` attribute the tests assert (`data-bracket-view`, `data-bracket-follow`, `data-bracket-branch`, `data-bracket-columns`, `data-bracket-round`, `data-bracket-match`, `data-bracket-path`); adds `data-bracket-section`, `data-bracket-slot`, `data-bracket-edges` (serialized resolved edge list per band, which is also what makes edges assertable in SSR strings).
- `apps/web/src/components/tournaments/bracket-connectors.tsx` — **new**, client-only measured SVG overlay per band. One line: turns resolved edges + live DOM offsets into elbow paths.
- `apps/web/src/lib/i18n.ts` — new keys in `copy.en.tournaments` after `bracketThirdPlace` (line ~383) and mirrored in `copy.ar.tournaments` (line ~1247): `bracketAwaitingWinner(slot)`, `bracketAwaitingLoser(slot)`, `bracketBestOf(n)`, `bracketSectionFallback` ("Bracket" / "المسار"). Follow the existing function-string pattern (`bracketRound: (round) => …`).
- `apps/web/src/test/bracket-view.test.tsx` — existing eight tests preserved (assert same attributes/strings); new draw-mode cases appended.
- `apps/web/src/test/tournament-draw.test.ts` — **new** unit tests for the projection (fixtures below).
- `apps/web/src/app/tournaments/[id]/page.tsx` — no change expected (payload flows through); touch only if TypeScript requires the new field.
- `scripts/seed-dev.mjs` — append a seeded official tournament + `upsertOfficialTournamentOverview` call carrying a small two-group draw payload (attribution string included), so `DB_PATH=<tmp> npm run seed:dev` gives a visual preview.

Deleted: nothing. `apps/web/src/lib/tournament-brackets.ts` and its test are **unchanged**.

Out of scope — do NOT touch, even though they look related: `src/services/officialEwcSheets/parsers.js` and `src/jobs/officialEwcSheets.js` (the graph producer; if its output doesn't match the shape below, STOP — do not "fix" the parser), `apps/web/src/lib/match-details.ts` (reads the same overview row for match pages), `apps/web/src/app/api/tournaments/[id]/matches/route.ts` (shape rides through `getTournamentMatchesCached`; no method/route changes, so no `api-authorization-policy.ts` fixture changes), `publicTournamentOverview` (the facts whitelist stays exactly as is).

## Data work

**No schema change, no bot change, no migration.** The projection layer gains one new server-side function over data that already exists.

Input shape (persisted at `tournament_overviews.payload_json.bracket` by `src/jobs/officialEwcSheets.js:718-730`; `stableValue` sorts object keys but **preserves array order**, so slot and group order survive):

```js
// one entry per drawn round (a "group" in parser terms)
{ column: 5, section: "Group A", title: "UB Ro8 (Quarter-finals)",
  bracket: "upper" | "lower" | "final" | "other", bestOf: 5,
  slots: [{ label: "UB 1.1", bracket: "upper",
            teamA: "FaZe Clan", teamB: "Winner of UB 1.2",
            scoreA: 3 | null, scoreB: 0 | null,
            status: "scheduled" | "running" | "finished",
            sourceA: null, sourceB: { outcome: "winner", slot: "UB 1.2" } }] }
```

`projectTournamentDraw(overviewRow, matchRows)` must produce, in order:

1. **Gate + validate.** Require `payload.attribution === "© Esports Foundation 2026. All rights reserved."` (same constant `publicTournamentOverview` checks). Reject non-array `bracket`, cap sections ≤ 12, rounds/section ≤ 16, slots/round ≤ 64. Sanitize every string with the `overviewText` discipline already in `tournaments.ts:364-371` (collapse whitespace, length caps, reject URLs/`docs.google` text). A section that ends up with zero valid slots is dropped; a payload that ends up with zero sections returns `null` (caller falls back to the label projection). Treat all sheet text as data — render through React/`<bdi>` only.
2. **Bucket rounds into sections** by sanitized `section` (empty → `bracketSectionFallback` copy), ordered by first appearance; within a section order rounds by `(column, appearance)`. Compute the section's track list = sorted unique `column`s.
3. **Slot keys.** `slotKey = normalize(label)` (lowercase, strip parentheticals like "(loser out)", collapse non-alphanumerics — mirror `normalizeTeamName`'s shape at `src/lib/render.js:32-40`); slots with no label get a synthetic `r<round>-s<index>` key. If two slots in one section normalize to the same key, remove **both** from the edge index (ambiguity never draws).
4. **Declared edges.** For each side with `sourceX = { outcome, slot }`, resolve `slot` against the same section's key index → `DrawEdge { from, to, outcome, kind: "declared" }`. Unresolvable references (cross-section, typos) produce no edge — the side still renders its awaiting chip.
5. **Traced edges** — the answer to "edges disappear once the sheet fills the slot in": when a side holds a real team name (not placeholder — reuse the `isBracketPlaceholder` reading: `/\b(?:winner|loser)\s+of\b|^(?:tbd|q)$/i`), search earlier-column rounds of the same section for slots with a **decided** result involving `normalizeTeamName(side)`; take the latest such column; if exactly one slot matches there, emit `{ …, outcome: won ? "winner" : "loser", kind: "traced" }`. Zero or two candidates → no edge. This is inference from complete information (the team literally appears in both slots), not positional arithmetic; a wrong line is prevented because ambiguity and absence both render nothing. These are the only two edge kinds that ever exist.
6. **Join slots to match rows** (for links, live status, logos, authority-leased scores): candidates = match rows with the same unordered normalized pair, exactly the `normalizedOfficialPair` reading (`src/jobs/officialEwcSheets.js:56-58` — reimplement web-side; `normalizeTeamName` is already imported in `tournaments.ts:19`). One candidate → join. Multiple (teams meet twice: groups then playoffs, or a GF reset) → join the one whose score pair equals the slot's (either orientation); still ambiguous → no join, slot renders unlinked. When joined, the match row's score/status/logos win (it carries the authority lease); otherwise the slot's own values render.
7. **Fallback adapter.** `drawFromLabelProjection(bracket)` wraps `BracketRound[]` as one section, sequential columns, no edges, every match pre-joined — so the view has exactly one rendering path.

What happens to tournaments already in the database: rows in `tournament_overviews` exist only for official EWC tournaments; active workbooks re-read once under parser v25 and gain the draw on the next scan. Archived tournaments whose workbooks are gone never gain one — they keep today's exact behaviour (label projection or plain match list). No backfill is possible and none is attempted.

## Ordered steps

Commands (from `AGENTS.md`, verified in recon): lint `npm --workspace @esports-community-bot/web run lint` · web tests `npm --workspace @esports-community-bot/web run test` (vitest; filter with `-- src/test/<file>`) · build `npm run web:build` · boundary `npm run security:boundary` (after the build) · bot tests `npm test` (only step 6 touches bot-side files). Branch off `main` per repo convention (`fix/…`/`feat(web)/…`); do not push or open a PR unless the operator says so.

1. **Projection module + tests.** Create `apps/web/src/lib/tournament-draw.ts` and `apps/web/src/test/tournament-draw.test.ts` (fixtures in Test plan). Pure library; no UI change.
   *Verify:* `npm --workspace @esports-community-bot/web run test -- src/test/tournament-draw.test.ts` → all pass; full web suite still green.
2. **Thread `draw` through the payload.** `tournaments.ts` computes it; `TournamentMatchesPayload` carries it; nothing renders it yet (dead data).
   *Verify:* web tests green; `npm run web:build` exits 0.
3. **Restructure `BracketView` around the unified model** with the label-projection adapter. Visual no-op for fallback mode except the grand-final/third-place columns joining the upper band. All eight existing `bracket-view.test.tsx` tests must pass **unmodified** — they are the migration contract.
   *Verify:* `npm --workspace @esports-community-bot/web run test -- src/test/bracket-view.test.tsx` → 8/8; lint clean.
4. **Render the draw**: sections, sheet-column tracks, slot cards with awaiting chips/best-of/live dot, joins, `data-bracket-slot`/`data-bracket-edges`, new i18n strings in both locales. SSR-complete without connectors.
   *Verify:* new SSR tests (below) pass; `DB_PATH=<tmp> npm run seed:dev` then `npm --workspace @esports-community-bot/web run dev` shows the seeded two-group draw in EN and `/ar` (manual gate).
5. **Connector overlay + follow integration.** `bracket-connectors.tsx`; follow control lifts on-path slots and recolours their run's edges.
   *Verify:* geometry helper unit tests (fake offsets) pass; SSR output contains **no** `<svg>` from the overlay (assert in test); full suite green.
6. **Seed + final gates.** Extend `scripts/seed-dev.mjs`; run everything.
   *Verify:* `npm test` (bot suite, because seed script changed) · web lint · web tests · `npm run web:build` · `npm run security:boundary` — all exit 0.

STOP conditions (do not improvise): the live/seeded `payload_json.bracket` doesn't match the shape excerpt above; preserving an existing `bracket-view.test.tsx` assertion would require changing its meaning; any fix appears to require touching an out-of-scope file (especially the sheets parser/job); a step's verification fails twice after a reasonable attempt.

## Test plan

Setup stays as-is: vitest, `environment: "node"`, `renderToStaticMarkup` string assertions (`apps/web/vitest.config.ts`; pattern file `apps/web/src/test/bracket-view.test.tsx`). **No new test infrastructure needed** — that is a design constraint honoured by putting every judgment (edge resolution, joins, sanitization) in pure server functions and making the client overlay dumb. `@testing-library/react` is not added; connector *geometry* is tested as a pure helper fed fake offset rectangles, and connector *inputs* are asserted via the serialized `data-bracket-edges` attribute in SSR output.

- `tournament-draw.test.ts` (new, model after `tournament-brackets.test.ts`): attribution gate (wrong/missing → null); sections bucketed and ordered, BO7-shaped fixture (two groups, same round title) yields two sections; declared edges resolve within-section only; ambiguous duplicate slot labels resolve nothing; traced edge appears when a decided winner's name fills a later slot, and does not when two candidates exist; placeholder detection (`TBD`, `Q`, `Winner of …`); join: unique pair joins, twice-met pair disambiguates by score, still-ambiguous doesn't join; sanitization (URL-bearing cell dropped, length caps, no `docs.google` text in output); PUBG-style empty `bracket` array → null; fallback adapter produces one edge-less section.
- `bracket-view.test.tsx` (extended): existing eight tests unchanged; new — draw mode renders `data-bracket-section` per group with headings; awaiting chip renders localized "Winner of UB 1.1" (en) and the Arabic string with `dir="rtl"`; joined slot renders `href="/matches/<id>"`, unjoined slot renders no `<a>`; `data-bracket-edges` contains exactly the declared+traced pairs of the fixture and nothing for the unresolvable reference; grand-final column renders inside `data-bracket-branch="upper"` when branches exist; SSR contains no overlay `<svg>`.
- Full gates from AGENTS.md as listed in Ordered steps; no `api-authorization-policy.ts` changes (no new/changed HTTP methods) and no boundary-fingerprint changes (no route shape changes) — but both suites still run.

## Failure modes

- **Half-drawn bracket** (the normal live state): undrawn slots carry declared sources → awaiting chips + declared connectors show the full future shape; played slots show scores; TBD everywhere degrades to today's card look. This is the case the design is *for*.
- **32 teams:** Ro32 = 16 slots in column one, ~6 tracks; horizontal scroll + snap paginates it on a phone; equal-share centring and ≤ ~31 edges are trivial for layout and the observer. No virtualization needed at this scale (EWC fields are ≤ 16 per group).
- **One round:** label projection returns null at `rounds.length < 2` → plain match list, unchanged. A draw section with a single round (BO7 groups today) renders as one honest column of slot cards — real data, no invented shape; the band rule no-ops.
- **Three-band draw** (upper + lower + unbranched): fallback mode now renders two bands, with grand final/third place converging at the upper band's right — the current third single-match band was the weakest part of the shipped layout. Sheets mode expresses the true third case (play-ins) as its own *section*, which is the correct reading.
- **Arabic:** `dir="rtl"` flips grid track order and snap; connectors measure the flipped layout so elbows are correct with zero RTL branches; awaiting chips are localized; Latin slot tokens ("UB 1.1") and team names sit inside `<bdi>` so mixed-direction text cannot reorder; numbers go through `formatNumber(value, "ar")`.
- **Bad or hostile sheet data:** validation drops what fails, attribution gates the whole payload, URLs never render, React escapes everything; worst case is `draw = null` — exactly today's site.

## Not doing

- **No positional edge inference for label-projected brackets.** Matches within a round are time-sorted, not draw-sorted; "slot i+j feed ⌈i/2⌉" lines would be confidently wrong. The brief's wrong-line test is the reason the fallback stays edge-less.
- **No cross-band connector lines** (loser drops, LB-final→GF). Liquipedia and fandom don't draw them; chips + follow-a-team tell the fall story without turning the gap between bands into spaghetti.
- **No ingest/schema changes and no new table for edges.** The overview document already persists the whole graph per read; traced edges are recomputable from it. Costing a migration for data we already have would be waste.
- **No new dependencies** (no `react-brackets`, no `@visx`, no measurement lib): the layout needs one `ResizeObserver` and one `<path>` generator, ~60 lines.
- **No measured vertical placement of slots** (feeder-average positioning): the flex-share approximation is visually correct when rounds halve and degrades gracefully when they don't; measuring would couple SSR output to client layout for marginal gain.
- **No pan/zoom, no minimap, no score count-up animations, no `@testing-library/react`.** Scroll + snap is the mobile interaction; the SSR-string harness stays the testing model.
- **Not fixing fallback coverage for start.gg** (ingesting `fullRoundText` would give real labels): correct idea, different layer — flag it as a follow-up in the PR description, out of this plan's scope.
