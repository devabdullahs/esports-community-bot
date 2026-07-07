# Plan 061 — Deep-audit fixes (2026-07-07)

Written against commit `fc0df08`. Four independent, low-risk fixes from the
`/improve deep` audit. Each is self-contained; do them in order but they don't
depend on each other. Match existing repo conventions (single quotes + ESM on
the bot side; the web side is TypeScript + Next App Router). Run the gate after
each fix.

**Repo verification gate (run from repo root):**
- Bot tests: `npm test`
- Web lint: `npm --workspace @esports-community-bot/web run lint`
- Web tests: `npm --workspace @esports-community-bot/web run test`
- Web build: `npm run web:build`

**Dual-DB rule (context):** the bot DB runs on better-sqlite3 (dev/test) AND
Postgres (prod). None of these fixes touch schema, so no schema files change.

---

## Fix 1 — YouTube non-200 responses must keep the previous status (not flap offline)

**Why:** `src/services/youtube.js` `getLiveChannels` treats any non-200 HTTP
response (e.g. a transient 429 rate-limit or 503) as "offline". For a channel
that is currently LIVE, a single 429 flaps its embed offline on the website and
can fire a false "went offline" — then a false "went live" on the next poll.
Only a genuine "page says not live" (a 200 that parses to not-live) should mean
offline. Network errors are already handled correctly (the `catch` omits the
handle, and the poller's `absentMeansOffline: false` keeps the prior status);
non-200 responses must behave the same way.

**Current code** (`src/services/youtube.js`, inside `getLiveChannels`):
```js
    try {
      const { status, data } = await client.get(channelLiveUrl(handle));
      const parsed = status === 200 ? parseLivePage(data) : null;
      out.set(handle, parsed?.isLive ? parsed : { isLive: false });
    } catch {
      // Network hiccup: report nothing for this handle so the poller keeps the
      // previous status instead of flapping a live embed offline.
    }
```

**Change:** only SET the map entry when the response is a parseable 200. On any
non-200 (or a 200 that fails to parse into an object), leave the handle OUT of
the map — identical to the network-error path — so the poller keeps the prior
status. A 200 that parses to not-live still correctly sets `{ isLive: false }`.

```js
    try {
      const { status, data } = await client.get(channelLiveUrl(handle));
      if (status !== 200) continue; // transient (429/5xx): keep previous status, don't flap
      const parsed = parseLivePage(data);
      out.set(handle, parsed?.isLive ? parsed : { isLive: false });
    } catch {
      // Network hiccup: report nothing for this handle so the poller keeps the
      // previous status instead of flapping a live embed offline.
    }
```

**Note on 404:** a genuinely missing channel returns 404, which under this fix
means "keep previous status" rather than "offline". That is acceptable — a
deleted/renamed channel eventually ages out via `markStaleStatusesOffline`
(the poller already forces not-recently-checked live rows offline). Do NOT add
special 404 handling.

**Test:** extend `tests/streamServices.test.mjs` (the file already has a
`youtube.getLiveChannels` test that injects a fake `client`). Add a case: a
handle whose `client.get` returns `{ status: 429, data: '' }` while it was
previously live must be ABSENT from the returned map (assert
`map.has('handle') === false`), and a `{ status: 200, data: OFFLINE_PAGE }`
handle must be present with `isLive === false`. Follow the existing
`makeClient`/injection style in that file.

**Boundaries:** only `src/services/youtube.js` and `tests/streamServices.test.mjs`.
Do NOT touch `src/jobs/streamStatus.js` (its `absentMeansOffline: false` for
youtube already does the right thing with an absent handle).

**Done when:** `npm test` passes with the new assertion; the new test fails if
you revert the `continue`.

---

## Fix 2 — Parallelize the homepage's independent data fetches

**Why:** `apps/web/src/app/page.tsx` awaits three independent cached reads
sequentially, so TTFB is the SUM of their latencies instead of the max.

**Current code** (`apps/web/src/app/page.tsx`, inside `export default async function Home()`):
```ts
  const games = await listGamesCached();
  const latestPosts = await listLatestPublishedNewsPostsCached(locale, 4);
  // ... (uses of games / latestPosts in between) ...
  const summaries = await listTournamentSummariesCached();
```
The three calls (`listGamesCached`, `listLatestPublishedNewsPostsCached`,
`listTournamentSummariesCached`) take no arguments derived from each other —
only `locale`, which is resolved earlier via `await getRequestLocale()`.

**Change:** after `locale` is resolved, fetch all three with `Promise.all`:
```ts
  const [games, latestPosts, summaries] = await Promise.all([
    listGamesCached(),
    listLatestPublishedNewsPostsCached(locale, 4),
    listTournamentSummariesCached(),
  ]);
```
Then delete the three original `await` lines. Keep every downstream use of
`games`, `latestPosts`, `summaries` exactly as-is (same variable names). Verify
nothing between the old lines depended on ordering (it doesn't — they're pure
reads).

**Boundaries:** only `apps/web/src/app/page.tsx`. Do not change the cached
functions themselves or any rendering.

**Done when:** `npm run web:build` succeeds and the homepage renders the same
sections (games grid, latest news, live/upcoming tournaments). No test change
needed (pure refactor).

**STOP condition:** if any of the three values IS used to compute the argument
of another of the three, do NOT parallelize that pair — report back instead.

---

## Fix 3 — Deduplicate the per-request session lookup with React `cache()`

**Why:** `SiteHeader` (server component, on every page) calls `getAdminAccess()`
which calls `getOptionalSession()`, and page-level code also resolves the
session — two identical session DB reads per request. `getOptionalSession` is a
plain async function (not memoized), so React does not dedupe them.

**Current code** (`apps/web/src/lib/session.ts`):
```ts
export async function getOptionalSession(): Promise<Session | null> {
  // ... body ...
}
```

**Change:** wrap the function body in React's request-scoped `cache()` so all
callers within one render share a single result. Preserve the exported name and
signature exactly.
```ts
import { cache } from "react";
// ...
export const getOptionalSession = cache(async (): Promise<Session | null> => {
  // ... unchanged body ...
});
```
`cache()` from `react` memoizes per-request (per React render pass), so this is
safe for auth data — it does NOT persist across requests. If the file already
imports from `react`, extend that import rather than adding a second one.

**Boundaries:** only `apps/web/src/lib/session.ts`. Do not change callers.

**Done when:** `npm run web:build` + web lint pass; the function still returns
the same shape. If `getOptionalSession` is already wrapped in `cache()`, STOP —
this fix is already done, report that.

---

## Fix 4 — Canvas render smoke test (regression guard, no behavior change)

**Why:** `src/lib/matchCard.js` (~700 lines of @napi-rs/canvas drawing, changed
recently for the day-grouped status card) has no test that actually RENDERS. A
font/context/state bug ships as a broken Discord image with no CI signal.

**Add** `tests/matchCardRender.test.mjs` — a smoke test that each exported
render function returns a valid PNG buffer without throwing. Pattern to follow:
the existing scratch render harness and other bot tests set required env before
importing. Set env first:
```js
process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.DB_PATH = ':memory:';
```
Then import from `../src/lib/matchCard.js` and assert. The render functions to
smoke-test and their rough call shapes (read the file's `export` signatures to
confirm before writing):
- `renderScheduleCard({ title, subtitle, matches, accent })` — pass 2-3 synthetic
  match rows `{ team_a, team_b, logo_a: null, logo_b: null, scheduled_at, tournament_name, game }`.
- `renderAllGamesStatusCard({ live: [], upcoming, updatedAt })` — pass a few
  upcoming rows (same shape) and an empty `live` array, then a variant WITH a
  live row.
- `renderMatchCard({ ... })` / `renderCardForMatch(matchRow)` — one synthetic row.
- `renderStatusCard({ title, subtitle, statusText, detail })`.

Each returns a `Buffer` (PNG). Assert it's a Buffer of non-trivial length and
starts with the PNG magic bytes:
```js
function assertPng(buf) {
  assert.ok(Buffer.isBuffer(buf) && buf.length > 1000, 'non-empty buffer');
  assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'PNG magic');
}
```
Pass `logo_a: null, logo_b: null` everywhere so no network/logo fetch is needed
(the renderers fall back to initials). Use `await` — some renderers are async.

**Boundaries:** only the new `tests/matchCardRender.test.mjs`. Do NOT modify
`src/lib/matchCard.js`.

**Done when:** `npm test` passes including the new file; if a renderer throws or
returns a non-PNG, the test fails.

**STOP condition:** if a render function's real signature differs from the
sketch above, read the actual `export function`/`export async function`
signature in `src/lib/matchCard.js` and match it — do not guess.

---

## Out of scope (considered, deliberately not planned)

- N+1 tournament-summary match queries (`lib/tournaments.ts`) — real but low
  leverage (60s-cached, single-guild low traffic, bounded N) and MED-risk to
  change mid-EWC. Skip.
- CSP `img-src https:` tightening — would break admin-pasted news covers from
  arbitrary hosts. Skip.
- Direction features (prediction lock reminders, match follows, tier roles) —
  need product decisions; not auto-built.
- `.env.example` missing `STARTGG_BASE_URL` / `LPDB_BASE_URL` — trivial doc-only;
  fold in opportunistically if touching `.env.example`, else skip.

## Status
| Fix | Status |
|-----|--------|
| 1 — YouTube non-200 status | TODO |
| 2 — Homepage parallel fetch | TODO |
| 3 — Session cache() dedup | TODO |
| 4 — Canvas render smoke test | TODO |
