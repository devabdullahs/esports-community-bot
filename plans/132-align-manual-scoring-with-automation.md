# Plan 132: Make manual prediction scoring honor automation readiness

> **Executor instructions**: Manual scoring is a recovery entry point, not an
> implicit force operation. Reuse the canonical readiness and locking rules; do
> not add a hidden bypass. If the operator requires force scoring, STOP and
> propose a separately confirmed/audited operation.
>
> **Drift check (run first)**: `git diff --stat 0718e2d..HEAD -- src/lib/ewcPredictionAdmin.js src/lib/ewcPredictionOperationValidation.js src/jobs/ewcPredictions.js src/db/ewcPredictions.js src/commands/ewc_admin.js apps/web/src/app/api/admin/predictions/route.ts tests/ewcPredictionOperations.test.mjs tests/ewcPredictionAutomation.test.mjs apps/web/src/test/admin-predictions-api.test.ts`

## Status

- **Status**: DONE
- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/129-serialize-prediction-round-transitions.md`, `plans/131-require-complete-authoritative-ewc-results.md`
- **Category**: bug
- **Planned at**: commit `0718e2d`, 2026-07-23

## Why this matters

The shared admin service could score an open or not-yet-due round and used
stored per-game results whenever any existed, so it never fetched missing
placements. It could therefore finalize stale or partial data that automation
would reject. Manual and automatic scoring now share one readiness decision and
differ only in who requested the attempt and how the failure is reported.

## Delivered

- One pure readiness evaluator is shared by manual and automatic week scoring.
- Week readiness reports stable reason codes for unopened, unlocked, open,
  delayed, missing-baseline, missing-result, untrusted, incomplete, stale, and
  ready states.
- Season readiness requires a closed and due season with at least `top_size`
  canonical final standings.
- Manual week scoring fetches only unresolved due games outside the transaction,
  merges snapshots without replacing complete stored data on a transient miss,
  then reacquires the transition lock and re-evaluates before writing.
- Manual week and season scoring reject early, stale, incomplete, and undersized
  results without accepting a generic force field.
- Durable operation history records safe readiness reason codes without fetched
  standings or member picks.
- SQLite, PostgreSQL, operation, automation, and web API tests cover the shared
  boundary.

## Scope

**In scope**:

- `src/lib/ewcPredictions.js`
- `src/lib/ewcPredictionAdmin.js`
- `src/jobs/ewcPredictions.js`
- `src/jobs/ewcPredictionOperations.js`
- Focused bot, PostgreSQL, and web operation tests

**Out of scope**:

- A force-score operation or bypassing missing/incomplete results.
- Changing scoring formulas or reopening already scored rounds.
- New dashboard UI.
- Network calls inside a DB transaction.

## Verification

| Purpose | Command |
|---|---|
| Admin/automation tests | `node --test tests/ewcPredictionOperations.test.mjs tests/ewcPredictionAutomation.test.mjs tests/ewcPredictionReadiness.test.mjs tests/ewcPredictionScoring.test.mjs` |
| PostgreSQL lane | `npm run test:postgres` |
| Bot suite | `npm test` |
| Focused web tests | `npm --workspace @esports-community-bot/web run test -- src/test/admin-predictions-api.test.ts` |
| Web lint | `npm --workspace @esports-community-bot/web run lint` |
| Web tests | `npm --workspace @esports-community-bot/web run test` |
| Web build | `npm run web:build` |

## Done criteria

- [x] Manual and automatic scoring use one readiness evaluator.
- [x] Partial stored results trigger focused missing-result fetches.
- [x] Open, early, stale, incomplete, and undersized rounds cannot be scored.
- [x] A ready round is scored atomically once.
- [x] No implicit force/bypass input exists.
- [x] All repository gates pass.

## Maintenance notes

Any new scoring entry point must consume the same evaluator and transition-lock
protocol. A future force operation should be separately named, strongly
confirmed, super-only, audited, and never permitted to score missing ranks.
