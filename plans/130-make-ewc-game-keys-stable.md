# Plan 130: Give EWC prediction games stable identities and migrate references

> **Executor instructions**: Do not replace keys without migrating every stored
> reference atomically. Key reconciliation must be bijective and dry-run capable;
> ambiguity is a STOP condition, never a reason to match by array position.
>
> **Drift check (run first)**: `git diff --stat 0718e2d..HEAD -- src/lib/ewcPredictions.js src/lib/ewcPredictionAdmin.js src/db/ewcPredictions.js src/commands/ewc_predict.js scripts tests/ewcPredictionScoring.test.mjs tests/ewcPredictionLifecycle.test.mjs tests/ewcPredictionReminders.test.mjs`

## Status

- **Status**: DONE
- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/129-serialize-prediction-round-transitions.md`
- **Category**: bug
- **Planned at**: commit `0718e2d`, 2026-07-23

## Why this matters

Persisted game keys previously ended in the event's globally sorted array
index. Adding or reordering one schedule event changed later keys, disconnecting
member picks, fetched results, and reminder rows from the configured game.
Stable keys now derive from event identity, and existing references are
reconciled atomically before a stored game array may be replaced.

## Implemented

- Canonical event identities prefer a normalized Liquipedia path and otherwise
  combine stable game/event metadata. Dates and collection position are not part
  of the identity.
- Generated keys use a readable slug plus a deterministic hash, contain only
  `[a-z0-9-]`, and are capped at 32 characters.
- A pure bijective reconciliation reports unchanged, rekeyed, added, removed,
  ambiguous, and unknown-reference cases without mutating input.
- Under the prediction transition lock, one transaction migrates week games,
  member picks, results, and reminder keys. Conflicting reminder rows coalesce
  only when their delivery state is identical.
- Existing-week generation reconciles instead of overwriting stored games and
  returns aggregate operator output without member data.
- `scripts/rekey-ewc-prediction-games.mjs` defaults to a no-write dry run.
  Applying requires both `--apply` and `--confirm-ewc-game-keys`; scored changes
  and unsafe mappings are refused.
- Discord component and modal IDs have explicit 100-character guards and tests.

## Verification

| Purpose | Command | Result |
|---|---|---|
| Focused prediction tests | `node --test tests/ewcPredictionGameKeyReconcile.test.mjs tests/ewcPredictionGameKeys.test.mjs tests/ewcPredictionOperations.test.mjs` | 19 passed |
| Extended focused suite | prediction lifecycle, reminder, picker, and scoring tests | 93 passed |
| Rekey dry-run | `node scripts/rekey-ewc-prediction-games.mjs` | exit 0; no writes |
| PostgreSQL lane | `npm run test:postgres` | migrations 11/11; parity 16/16 |
| Bot suite | `npm test` | 756 passed; 9 skipped; 0 failed |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | passed |
| Web tests | `npm --workspace @esports-community-bot/web run test` | 908 passed |
| Web build | `npm run web:build` | passed |

## Done criteria

- [x] No generated key depends on collection position or timestamps.
- [x] Existing picks, results, and reminders migrate atomically.
- [x] Ambiguous/unknown references fail closed without writes.
- [x] Regeneration cannot blindly orphan stored references.
- [x] Dry-run is default and output contains no member data.
- [x] Discord custom IDs remain within 100 characters.
- [x] All repository gates pass.

## STOP conditions

- Two existing events produce the same canonical identity.
- A referenced old event has no unique regenerated match.
- Production-like scored rows require changing keys rather than confirming an
  already migrated state.
- A reminder-key collision contains different delivery state.

## Maintenance notes

Event identity is persisted data. Future schedule parsers may enrich labels and
dates, but must preserve the canonical URL/path identity or provide an explicit
migration.
