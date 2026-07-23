# Plan 135: Route Liquipedia MediaWiki requests through one scheduler

> **Executor instructions**: Maintain one serialized admission chain for parse
> and search requests, preserve persistent backoff, and use fake clocks/HTTP in
> tests. No test may contact Liquipedia. Do not add a parallel axios path.
>
> **Drift check (run first)**: `git diff --stat 0718e2d..HEAD -- src/services/liquipedia/client.js src/services/liquipedia/rateState.js src/services/liquipedia.js tests .env.example`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `0718e2d`, 2026-07-23

## Why this matters

Repository policy requires one serialized Liquipedia request path, but parse and
opensearch currently use independent promise chains and can overlap. Search
configuration can also reduce the intended 2.5-second gap to 2 seconds. A
single scheduler with per-kind spacing and persisted shared admission state
prevents sleeper bursts, cross-kind overlap, and restart resets.

## Current state

- `src/services/liquipedia/client.js:23-30` enforces a 30-second parse floor but
  uses `Math.max(2_000, configuredSearchGap)` for search.
- Lines 54-62 define `parseChain` and `searchChain` independently.
- `throttleParse` consults persisted `rateState.lastRequestAt` plus in-memory
  `lastSearchAt`; `scheduleSearch` updates only `lastSearchAt`.
- `src/services/liquipedia/rateState.js` persists `lastRequestAt` and
  `blockedUntil`, but not a parse-specific timestamp.
- Cache/in-flight behavior and graceful stale/empty fallbacks are valuable and
  must remain.
- Official terms allow at most one general MediaWiki request per two seconds
  and one `action=parse` per 30 seconds. This repository intentionally keeps a
  safer 2.5-second search floor.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Scheduler tests | `node --test tests/liquipediaClient.test.mjs tests/liquipediaRateState.test.mjs` | all pass; no real waits/network |
| Parser tests | `node --test tests/liquipediaParsers.test.mjs` | all pass; fixtures only |
| Bot suite | `npm test` | all pass |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

## Scope

**In scope**:

- `src/services/liquipedia/client.js`
- `src/services/liquipedia/rateState.js`
- `src/services/liquipedia/scheduler.js` (new, if extraction keeps tests clean)
- `tests/liquipediaClient.test.mjs` (new)
- `tests/liquipediaRateState.test.mjs` (new)
- `.env.example` only if existing Liquipedia variables need corrected minimum
  documentation

**Out of scope**:

- Parser/fetcher behavior or new Liquipedia endpoints.
- LPDB scheduling; plan 136 owns its separate 60/hour quota.
- Cache eviction/performance work.
- Logo-download channel architecture; it continues coordinating through the
  persisted provider timestamp and needs a separate cross-process design if
  stronger serialization is required.

## Git workflow

- Branch: `codex/135-liquipedia-request-scheduler`
- Commit style: `fix(liquipedia): unify MediaWiki request scheduling`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Write a fake-clock scheduler specification

Add deterministic tests for a scheduler receiving request kind `parse` or
`search`. Cover:

- all tasks execute one at a time in admission order;
- searches start at least 2,500 ms after any prior request;
- parses start at least 30,000 ms after the prior parse and at least 2,500 ms
  after any other request;
- a queued search cannot overlap a sleeping/running parse and vice versa;
- persisted state after restart preserves both shared and parse-specific gaps;
- global backoff rejects before a task runs;
- one rejection does not poison the chain;
- search queue cap frees its slot on success/failure.

Inject `now` and `sleep`; never wait real seconds.

**Verify**: cross-kind overlap/persistence tests fail against the two-chain
implementation.

### Step 2: Extend rate-state compatibility

Persist `lastRequestAt`, `lastParseAt`, and `blockedUntil`. When reading the old
two-field file, conservatively treat old `lastRequestAt` as both shared and
parse timestamps. Validate finite non-negative numbers and ignore malformed
state without throwing, matching existing first-run behavior.

Writes must remain atomic enough that interruption does not leave malformed
JSON: write a sibling temporary file and rename it. Never persist URLs, query
terms, user data, or tokens.

**Verify**: rate-state tests cover old format, new format, corrupt/missing file,
and atomic replacement.

### Step 3: Replace both chains with one scheduler

Implement one promise chain. Each admitted task reloads persisted state, checks
backoff, waits for the maximum applicable floor, reloads after waiting, stamps
state immediately before HTTP, then invokes the task.

Set the search minimum as `Math.max(2_500, configuredValue)`; parse remains at
least 30,000. Retain the search queue cap and parse/search in-flight dedupe.
Keep cache rechecks after queue wait.

**Verify**: scheduler and client tests prove serialized order and exact fake
timestamps.

### Step 4: Preserve response/error semantics

Keep parse stale-cache fallback, search empty-result behavior, strict-search
success detection, response byte limits, user agent, gzip, and backoff marking.
Centralize rate-limit status/body detection so both request kinds mark the same
persisted block.

Do not log search terms, response bodies, or headers while refactoring.

**Verify**: injected HTTP tests cover cached hit (zero admission), duplicate
single-flight, 403/429/503 backoff, non-rate error fallback, and recovery after
chain rejection.

### Step 5: Run all gates and audit network paths

Run every command. `rg -n "axios\.(get|post)|axios\.create" src/services/liquipedia`
must show only the intended client construction, with every request invocation
inside a scheduled task.

## Test plan

- Pure fake-clock scheduler timing and serialization.
- Persistent state migration/restart behavior.
- Injected HTTP cache, single-flight, backoff, and queue-full cases.
- No parser test/network behavior changes.

## Done criteria

- [ ] Parse and search share one admission chain.
- [ ] Search spacing cannot be configured below 2.5 seconds.
- [ ] Parse spacing remains at least 30 seconds.
- [ ] Shared/parse timestamps and backoff survive restart.
- [ ] Cache, in-flight, and graceful error contracts remain.
- [ ] No tests call Liquipedia or wait real rate-limit intervals.
- [ ] All repository gates pass.

## STOP conditions

- A caller requires search to bypass a queued parse for correctness rather than
  latency; report it instead of creating a second network path.
- Persisted-state compatibility cannot be preserved.
- The refactor requires moving parser logic into the client/facade.
- A test attempts to contact `liquipedia.net`.

## Maintenance notes

All future MediaWiki actions must declare a scheduler kind and use this single
admission chain. Changing limits requires updating fake-clock tests and the
canonical environment documentation.

