# Performance and player enrichment — 2026-09-06

## Findings and changes

- The local preview runs `next dev`, which compiles routes on demand. A pre-change `/players/1` request took 4,806ms to first byte; the next request took 189ms. `/news` measured 446ms then 130ms. These are development observations on a tiny disposable SQLite fixture, not production latency or a before/after speedup claim.
- The newsroom first page previously queried the database on every render. It now has four finite cache keys: English/Arabic × all/EWC, with a 60-second lifetime and existing CMS invalidation tags. Arbitrary offsets, limits, and searches remain outside the persistent cache.
- Profile reads now use React request memoization, so metadata and page rendering can share a lookup. This is not a cross-request profile cache: background enrichment remains visible on subsequent requests. Removed a render-time mutation of the shared player object.
- Independent header lookups and player follow/match/MVP lookups now run together instead of serially.
- Player and team profile rendering reuses stored history and achievements. Fresh Liquipedia snapshots explicitly persist empty arrays, distinguishing “parsed and absent” from “legacy snapshot needs HTML fallback.” Legacy snapshots still recover from their stored raw HTML.
- Team discovery previously ran through its phase before parsing biographies. A large team list could consume every request slot. The job now gives one pending biography a turn after each successfully parsed roster, then drains the remainder as before. EWC priority, the total run budget, stored roster links, transfer verification, and conservative name resolution remain intact.
- Freshness checks now accept SQLite UTC text, ISO timestamps, Date objects, and explicit offsets without appending a second timezone marker. This avoids unnecessary enrichment of fresh rows.

## Limits and safety boundaries

No parallel Liquipedia network path, shorter rate interval, larger run budget, new environment variable, or API method was added. Search and parse requests still use the shared scheduler and persistent backoff. The enrichment job still runs on its existing schedule; no live Liquipedia enrichment or production data mutation was performed during this task.

A separate loopback `next start` benchmark was rejected by automatic approval review as “blocked by policy,” with no more specific reason supplied. The production build and repository boundary probe remain the validation path; no production-speed gain is claimed. Next's [development environment guide](https://nextjs.org/docs/app/guides/local-development) explains the distinction between development compilation and production rendering.

## Regression evidence

New tests prove that a three-request budget completes search → team parse → biography, timestamp formats respect the TTL, structured snapshots skip HTML parsing while legacy fallback remains available, and only four newsroom cache keys are admitted. Existing enrichment tests also cover roster transfers, truncated-roster protection, EWC priority, and budget limits.

Final checks passed:

- `npm test`: 999 passed, 16 existing skips.
- Web lint and native TypeScript: passed.
- `npm --workspace @esports-community-bot/web run test -- --maxWorkers=2`: 1,474 tests across 145 files passed.
- `npm run web:e2e`: all 46 desktop/mobile journeys passed.
- `npm run web:build`: passed.
- `npm run security:boundary`, after the build: passed.

Raw local logs are under `plans/redesign-evidence/performance-*` (ignored). The source changes and regression tests are committed on `codex/performance-profile-enrichment`.
