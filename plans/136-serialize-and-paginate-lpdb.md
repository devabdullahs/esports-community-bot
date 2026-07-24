# Plan 136: Serialize, persist, and paginate LPDB schedule requests

> **Executor instructions**: Preserve the operator's current uncommitted
> `scheduleConditions` work in `src/services/lpdb.js` and
> `tests/lpdb.test.mjs`. Do not discard or overwrite it. Use the official
> offset/limit continuation rule and the approved 60-request/hour quota. Tests
> must inject HTTP/time and never use the real API key or endpoint.
>
> **Drift check (run first)**:
> `git diff --stat 0718e2d..HEAD -- src/services/lpdb.js src/services/liquipedia/fetchers.js tests/lpdb.test.mjs .env.example`
>
> Also run `git diff -- src/services/lpdb.js tests/lpdb.test.mjs` and compare it
> with the Current state section. At planning time both files contain
> operator-owned uncommitted changes for the `parent`/`pagename` condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `0718e2d` plus the documented local LPDB condition
  changes, 2026-07-23

## Why this matters

LPDB uses a shared in-memory timestamp without a queue, so concurrent cache
misses can wake and issue requests together; restart also forgets spacing and
backoff. Schedule reads stop after one 200-row page, while any non-empty result
suppresses the HTML fallback, silently truncating large tournaments. This plan
adds one persisted/single-flight LPDB scheduler and consumes official
`limit`/`offset` pages until the final short page.

## Current state

- `src/services/lpdb.js:14-15` sets a 65-second minimum gap and five-minute
  cache for the official 60/hour quota.
- Lines 27-52 use `lastAt`, a `Map`, and unsynchronized `throttle()`; there is no
  in-flight map or persisted block.
- The request uses `{ limit: 200, order: 'date ASC' }` and no offset.
- Current uncommitted lines 97-105 add a sanitized condition:
  `[[parent::<page>]] OR [[pagename::<page>]]`; preserve this behavior and its
  tests.
- `src/services/liquipedia/fetchers.js:160-169` accepts any non-empty LPDB array
  as complete and falls back to MediaWiki immediately on every error.
- Official Liquipedia guidance documents offset pagination: increment `offset`
  by `limit` while a page has exactly `limit` rows, and stop on a short page:
  <https://liquipedia.net/commons/Support/Bot/Advanced_Usage>.
- The terms require no more than 60 LPDB requests/hour and long-lived caching:
  <https://liquipedia.net/api-terms-of-use>.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| LPDB tests | `node --test tests/lpdb.test.mjs` | all pass; fake clock/HTTP only |
| Fetcher tests | `node --test tests/liquipediaParsers.test.mjs tests/lpdb.test.mjs` | all pass; no network |
| Bot suite | `npm test` | all pass |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

## Scope

**In scope**:

- `src/services/lpdb.js`
- `src/services/liquipedia/fetchers.js`
- `src/services/lpdbRateState.js` (new, or equivalent small state module)
- `tests/lpdb.test.mjs` (extend the existing uncommitted file)
- `.env.example` for any new LPDB state/backoff variable

**Out of scope**:

- Changing the operator's `parent OR pagename` condition semantics.
- MediaWiki scheduling from plan 135.
- Increasing the LPDB quota or parallelizing pages.
- Guessing private dashboard-only response fields when `result` plus
  offset/limit is sufficient.
- Enabling LPDB without `LPDB_API_KEY`.

## Git workflow

- Branch: `codex/136-lpdb-queue-pagination`
- Commit style: `fix(lpdb): serialize and paginate schedules`
- Preserve and include the existing LPDB condition changes only if the operator
  intends this branch to own them; otherwise STOP for a clean base.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Refactor behind injected HTTP and time

Extract a small client factory or internal dependency object accepting
`http.get`, `now`, `sleep`, and rate-state load/save. Keep the public singleton
exports `isEnabled`, `normalize`, `scheduleConditions`, and `fetchSchedule`.
Tests must instantiate the internal client with fakes.

Add baseline tests proving current schedule condition and normalization behavior
before changing request admission.

**Verify**: tests run with a fake API key/client and no DNS/network access.

### Step 2: Add one persisted scheduler and single-flight cache

Implement one promise chain for all LPDB requests. Persist only
`lastRequestAt` and `blockedUntil` in a configurable state path under `data/` by
default. Use safe temp-file replacement and tolerate missing/corrupt state.

Before each request, reload state, reject/serve stale during backoff, wait until
`lastRequestAt + 65_000`, reload again, stamp immediately before HTTP, and then
run the request. Mark 403/429/503 as a persisted block, honoring a sane bounded
`Retry-After` when present and otherwise using a documented default.

Add an in-flight map keyed by wiki/conditions so identical schedule traversals
share one promise. Delete the entry in `finally`. Cache complete results and
retain stale data for backoff fallback; bound/expire cache entries while touched
so it does not grow forever.

**Verify**: fake-clock tests prove two concurrent misses are 65 seconds apart,
identical misses single-flight, restart spacing persists, and rejection does
not poison the queue.

### Step 3: Traverse offset pages serially

For one schedule query:

1. request `limit=200`, `offset=0`, stable `order='date ASC'`;
2. append `data.result` (also retain the existing tolerated response wrapper);
3. stop when the page contains fewer than 200 rows;
4. otherwise increment offset by 200 and schedule the next request through the
   same 65-second queue.

Set a conservative maximum page count/row count (for example 25 pages/5,000
rows). If the maximum is reached on a full page, throw a typed truncation error
instead of returning partial data. Dedupe only after the complete traversal.

**Verify**: tests cover 0, 199, 200+short, multiple full pages, duplicate IDs
across pages, malformed result, mid-pagination error, and maximum-page refusal.

### Step 4: Prevent provider-amplifying fallback

Return typed LPDB errors distinguishing rate/backoff/truncation from ordinary
unsupported-query/empty results. In `fetchers.js`:

- ordinary empty or non-rate functional failure may use the existing serialized
  MediaWiki fallback;
- an LPDB 403/429/503 or active persisted block must not immediately issue a
  second Liquipedia request through MediaWiki; serve complete stale LPDB data if
  available, otherwise propagate/skip this sync cycle;
- never treat a truncated partial page set as complete.

Keep logs sanitized and bounded; no conditions containing unexpected user input
or API response body should be logged.

**Verify**: injected fetcher tests assert zero MediaWiki calls on LPDB rate
block/truncation and one fallback on a normal empty/unsupported result.

### Step 5: Run all gates and inspect the local diff

Run every command. Confirm the original `scheduleConditions` tests still pass
and `git diff` does not remove the operator's current LPDB work. Verify no test
contains a real key or calls `api.liquipedia.net`.

## Test plan

- Existing condition sanitization and normalization.
- Fake-clock queue, single-flight, persisted restart, and backoff.
- Official offset/limit pagination and hard truncation refusal.
- Stale-cache behavior.
- MediaWiki fallback classification without provider amplification.

## Done criteria

- [ ] Every LPDB HTTP request uses one 65-second serialized scheduler.
- [ ] Admission/backoff state survives restart.
- [ ] Identical concurrent schedule requests single-flight.
- [ ] Pagination continues until a short page and never returns known partials.
- [ ] LPDB rate blocks do not trigger immediate MediaWiki traffic.
- [ ] Existing local condition work is preserved.
- [ ] No test uses real Liquipedia traffic or credentials.
- [ ] All repository gates pass.

## STOP conditions

- The working-tree LPDB changes differ from the documented condition work or
  belong to another active executor.
- The approved dashboard documents a continuation contract different from
  offset-plus-limit; capture a sanitized response shape and revise the plan.
- More than the maximum page count is a legitimate schedule requirement.
- Avoiding fallback on rate limit would cause a destructive local state update
  rather than simply skipping a sync cycle.

## Maintenance notes

LPDB pages are individual billable/rate-limited requests. New LPDB endpoints
must reuse this scheduler/state and define whether partial pagination is ever
acceptable; schedules require complete traversal.

