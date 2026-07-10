# Plan 081: Make the public MCP fast, complete, and directly linkable

> **Executor instructions**: Keep the endpoint open and read-only. Reuse the
> shared MCP manifest so admin MCP receives every new public tool automatically.
> Never expose raw enrichment, auth, session, audit, key, or draft fields.
> Update `plans/README.md` when complete.
>
> **Drift check (run first)**: `git diff --stat ba288a1..HEAD -- apps/web/src/app/api/public-mcp apps/web/src/lib/public-mcp-tools.ts apps/web/src/lib/public-mcp-auth.ts apps/web/src/lib/public-mcp-copy-page.ts apps/web/src/app/docs/mcp src/lib/mcpToolManifest.js src/db/ewcNewsPosts.js apps/web/src/lib/news.ts apps/web/src/test/public-mcp-api.test.ts`

## Status

- **Execution**: DONE (2026-07-10)
- **Priority**: P2
- **Effort**: M-L
- **Risk**: MED
- **Depends on**: plan 080
- **Category**: perf
- **Planned at**: commit `ba288a1`, 2026-07-10

## Why this matters

The public MCP is safe and well-tested, but some outputs are awkward for agents
and one important tool can wait on live Liquipedia during a request. News URLs
are relative, global search examines only the latest 51 posts, and Club
Championship standings are available only through a broad club-summary tool.
Agents need deterministic stored reads, absolute links, complete bounded
search, and unambiguous prediction-versus-club standings tools.

## Current state

- `apps/web/src/lib/public-mcp-tools.ts:85-109` returns relative news URLs.
  `apps/web/src/lib/metadata.ts:56-59` already has the canonical `absoluteUrl`
  helper.
- Global `search_news` fetches 51 latest posts at
  `public-mcp-tools.ts:312-335` and then filters in memory. Older matches are
  therefore invisible even though the tool is named search.
- `src/db/ewcNewsPosts.js:282-292` confirms the global helper has a hard ceiling
  of 51; game search is unbounded and media search has a separate limit.
- `public-mcp-tools.ts:396-427` calls `getEwcClubTrackerForMcp(8_000)`.
  `apps/web/src/lib/ewc-clubs.ts:664-675` waits for the live cached tracker to
  time out before DB fallback. Plan 080 provides the current stored snapshot.
- `src/lib/mcpToolManifest.js:136-145` explicitly labels
  `get_public_ewc_leaderboard` as prediction rankings. Preserve that tool and
  add a separately named Club Championship standings tool.
- The endpoint rejects JSON-RPC batch arrays and validates browser Origin in
  `apps/web/src/app/api/public-mcp/route.ts:9-29` and
  `public-mcp-auth.ts:27-41`. Preserve these controls.
- Rate keys intentionally trust only `cf-connecting-ip` at
  `public-mcp-auth.ts:44-47`; tests reject spoofed forwarding headers. Do not
  reintroduce `x-forwarded-for` trust.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Public MCP tests | `npm --workspace @esports-community-bot/web run test -- src/test/public-mcp-api.test.ts src/test/mcp-tool-manifest.test.ts src/test/mcp-assistant-links.test.ts` | all pass |
| Bot tests | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

## Scope

**In scope**:

- `src/db/ewcNewsPosts.js`
- `apps/web/src/lib/news.ts`
- `apps/web/src/lib/public-mcp-tools.ts`
- `src/lib/mcpToolManifest.js`
- `apps/web/src/lib/public-mcp-copy-page.ts`
- `apps/web/src/app/docs/mcp/page.tsx`
- Admin MCP registration/tests only as required to inherit the public tool
- `apps/web/src/test/public-mcp-api.test.ts`
- MCP manifest/docs/assistant-link tests

**Out of scope**:

- Authentication keys or write tools on the public endpoint.
- Changing trusted proxy headers or rate-limit semantics.
- Live external HTTP calls from MCP handlers.
- Admin drafts, queues, audit logs, sessions, raw enrichment, or secrets.

## Steps

### Step 1: Add one bounded public news search query

Create a parameterized DB helper that searches published translations by
query, locale, optional game/media owner, EWC flag, limit, and offset. Search
title, summary, and body using the dual-backend SQL subset already used by the
repo. Return only IDs/rows that hydrate to published public posts. Add a stable
published-at/id ordering and clamp all bounds.

Replace the MCP in-memory latest-51 filter. Empty query remains a recent feed;
non-empty query must find an older matching fixture beyond 51 newer posts.

**Verify**: tests cover old result discovery, game+query, media+query,
locale, EWC, pagination, and draft exclusion.

### Step 2: Normalize public links and result metadata

Use `absoluteUrl` for all site-owned links returned by tools (news, tournament
detail, team/player profile, club directory/standings, prediction leaderboard).
Keep third-party source links separately named. Add a small consistent envelope
where useful: `generatedAt`, `sourceUpdatedAt`, `nextOffset`, and canonical
`webUrl`; do not wrap responses so deeply that existing fields become hard to
use.

**Verify**: every returned site URL starts with the configured public base in
tests and no source URL is accidentally rewritten.

### Step 3: Make Club Championship reads snapshot-only

Consume plan 080's stored/cached projection for `get_ewc_club_summary`. A
public MCP request must never trigger or await a live Liquipedia request. Return
last-updated/data-source/staleness metadata so an agent can describe freshness
honestly.

**Verify**: mock Liquipedia fetchers to never resolve; both club MCP tools still
complete from a stored snapshot inside a short test deadline.

### Step 4: Add `get_ewc_club_standings`

Add a manifest entry with surfaces `public` and `admin`, kind `read`, and
`adminGrant: always`. Return the official rank-ordered plan 080 projection with
optional region/query/limit/offset. The name, title, descriptions, and docs must
say Club Championship standings. Keep `get_public_ewc_leaderboard` explicitly
described as community prediction rankings.

Because admin MCP registers public always-on tools from the manifest, verify a
single admin key sees the new read tool without configuring a second MCP.

### Step 5: Improve tool discovery without exposing internals

Update English/Arabic docs and copy-page output with short example questions
and the distinction between standings and predictions. Keep the public-facing
security wording concise; document read-only behavior and rate limits without
listing private admin implementation details.

### Step 6: Production-like probe

Run a local Streamable HTTP probe for `tools/list` and every public tool, then a
stored-snapshot timeout probe. Assert HTTP 200, `isError !== true`, structured
content, bounded payloads, and absolute links. Repeat through an admin MCP test
key to prove public-tool parity.

## Done criteria

- [x] Public news search is complete within bounded filters, not latest-51 only.
- [x] Site-owned URLs are absolute and directly usable by agents.
- [x] Club tools never wait on live Liquipedia in a request.
- [x] Club standings and prediction rankings have distinct tool names/copy.
- [x] Admin MCP automatically includes the new public tool.
- [x] Public field-minimization and all security controls remain tested.
- [x] All required repo checks pass.

## STOP conditions

- Plan 080 has not provided a durable latest standings snapshot.
- Search requires database-specific full-text syntax; use the portable bounded
  query first and report a separate indexing plan.
- Any proposed response field contains raw/auth/admin-only data.
- The MCP SDK transport contract has changed; consult current official SDK docs
  before adapting it.

## Maintenance notes

All public/admin overlap remains declared in `mcpToolManifest.js`. New public
tools should default to stored/cached application data, absolute site URLs, and
bounded pagination. External refresh belongs in bot jobs, not request handlers.
