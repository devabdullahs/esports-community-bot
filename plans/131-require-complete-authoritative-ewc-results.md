# Plan 131: Require authoritative and complete EWC results before final scoring

> **Executor instructions**: Keep partial placements available for provisional displays, but never mark a round final without explicit source evidence and rank coverage. Parser tests must use fixtures only; no test may call Liquipedia.
>
> **Drift check (run first)**: `git diff --stat 0718e2d..HEAD -- src/services/liquipedia/parsers.js src/services/liquipedia/fetchers.js src/services/liquipedia.js src/lib/ewcPredictions.js src/jobs/ewcPredictions.js tests/liquipediaParsers.test.mjs tests/ewcPredictionScoring.test.mjs`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `0718e2d`, 2026-07-23

## Why this matters

The parser chooses the highest-scoring prize table even when every candidate has zero authoritative markers, and final readiness currently requires only one 1,000-point champion row. A qualifier table or champion-only snapshot can then permanently score all absent placements as zero. The correct split is to retain partial data for provisional scoring while requiring explicit final-table evidence and complete awarded-rank coverage before changing round status.

## Current state

- `src/services/liquipedia/parsers.js:109-122` ranks `.prizepooltable` candidates but returns the first table even when its score is zero.
- `parseEwcEventPlacements` at lines 1096-1148 returns only a placement array, losing which table/panel supplied it and why it was trusted.
- `src/lib/ewcPredictions.js:117-120` considers a result complete when any row has a club and 1,000 points.
- `ewcGameResultsFinalReady` adds freshness at lines 165-173 but reuses that weak completeness predicate.
- `scorePerGameWeeklyPrediction` awards ranks 1-8 from `EWC_POINTS_BY_RANK`; range labels such as `5-8` are valid coverage.
- Existing parser fixtures cover an earlier qualifier table, Club Points prize tables, solo-player mapping, and a battle-royale final standings panel.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Parser tests | `node --test tests/liquipediaParsers.test.mjs` | all pass; no network |
| Scoring/readiness tests | `node --test tests/ewcPredictionScoring.test.mjs tests/ewcPredictionAutomation.test.mjs` | all pass |
| Bot suite | `npm test` | all pass |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

## Scope

**In scope**:

- `src/services/liquipedia/parsers.js`
- `src/services/liquipedia/fetchers.js`
- `src/services/liquipedia.js` facade exports if needed
- `src/lib/ewcPredictions.js`
- `src/jobs/ewcPredictions.js`
- `src/lib/ewcPredictionAdmin.js` only to consume the shared readiness result; plan 132 owns manual timing policy
- `tests/liquipediaParsers.test.mjs`
- `tests/ewcPredictionScoring.test.mjs`
- `tests/ewcPredictionAutomation.test.mjs`

**Out of scope**:

- Changing EWC point values or awarding points beyond ranks 1-8.
- Treating page age alone as proof of finality.
- Scraping non-API pages or adding a parallel fetch path.
- Automatically rescoring already scored rounds.

## Git workflow

- Branch: `codex/131-authoritative-ewc-results`
- Commit style: `fix(predictions): require complete final results`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add adversarial parser and readiness fixtures

Add fixtures for qualifier-only table with no Club Points/prize evidence; champion-only prize table; ranks 1-4 present but 5-8 absent; a full Club Points table with tied/range rows such as `5-8`; a full final standings panel with ranks 1-8; duplicate/missing club rows and two apparent champions.

Assert qualifier/partial data may be parsed for diagnostics but is not authoritative/complete. Assert range labels cover every integer in the range.

**Verify**: final-readiness cases fail against the current champion-only rule.

### Step 2: Preserve parser evidence

Add a result-oriented parser, for example `parseEwcEventResult`, returning:

```js
{
  placements,
  evidence: {
    kind: 'club-points-prize-table' | 'prize-table' | 'final-standings-panel' | 'untrusted',
    authoritative: true | false,
    coveredRanks: [1, 2, 3, 4, 5, 6, 7, 8],
  },
}
```

Keep `parseEwcEventPlacements` as a compatibility wrapper returning only the array for callers/tests that need it. Change `ewcPrizePoolTable` to return no trusted table when the best score is zero. Trust a final-standings panel only through the existing explicitly supported panel shape.

Do not infer authority from row count alone.

**Verify**: fixture tests assert evidence kind, authority, and covered ranks.

### Step 3: Carry evidence through fetch and storage

Update `fetchEwcEventPlacements` and the batched week-result fetcher so each result carries bounded evidence. The tracked-final-standings fallback must add its own explicit source kind and computed rank coverage. Keep error objects and existing placement fields backward-compatible.

Persist evidence inside the existing `results_json`; no schema migration is needed. Bound it to the fixed fields above--do not store raw HTML/header text.

**Verify**: fetcher tests with injected parse responses prove evidence survives without network calls.

### Step 4: Define canonical completeness

Replace the champion-only predicate with a pure evaluator returning a reasoned result. Final completeness requires authoritative evidence from a supported source; exactly one covered champion with a non-empty club; every awarded rank 1 through 8 covered, accepting ranges such as `5-8`; and no placement used for coverage with an empty club or unrecognized place.

Legacy snapshots without evidence are incomplete and should be refetched; they may still contribute to provisional display. Freshness checks remain separate and still require fetch time after event end/score delay.

**Verify**: tests distinguish `untrusted_source`, `missing_rank`, `multiple_champions`, `invalid_club`, `stale`, and `ready`.

### Step 5: Gate final scoring while preserving provisional behavior

Use the evaluator in automation. Partial authoritative results may continue to produce provisional scores, but `markEwcWeekScoredWithResults` must require all games to be ready. Log bounded reason codes, not placement payloads or member data. Never alter already scored weeks automatically.

**Verify**: automation tests prove champion-only/missing-rank snapshots remain unscored and a complete fresh result scores exactly once.

### Step 6: Run all gates

Run every command. Confirm tests do not resolve or call `liquipedia.net` and the 31-line facade remains a re-export facade rather than gaining logic.

## Test plan

- Fixture-based parser evidence for all source shapes.
- Pure rank-range coverage and reason codes.
- Legacy no-evidence snapshots are provisional-only.
- Fresh complete result finalizes; stale or partial does not.
- Already scored rounds remain untouched.

## Done criteria

- [ ] Zero-score/qualifier tables are never considered authoritative finals.
- [ ] Result evidence survives parsing, fetching, and JSON persistence.
- [ ] Final readiness requires authoritative ranks 1-8 plus freshness.
- [ ] Partial results remain usable only for provisional scores.
- [ ] No tests access Liquipedia.
- [ ] All repository gates pass.

## STOP conditions

- A real supported EWC event awards fewer than ranks 1-8; capture its sanitized fixture and report before weakening the rule globally.
- A supported final source cannot be distinguished from a qualifier using bounded structural evidence.
- Existing scored rows would be automatically reopened or rescored.

## Maintenance notes

When Liquipedia changes markup, add a fixture and explicit evidence kind. Never relax completeness to "has a winner"; scoring absent placements as zero is a financial/competition-integrity decision.
