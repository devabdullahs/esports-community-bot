# Plan 071: Make admin MCP news search honor locale and combined owner filters

> **Executor instructions**: Follow the steps exactly. Preserve existing admin
> dashboard list semantics while adding the MCP query behavior described here.
> Update `plans/README.md` after completion.
>
> **Drift check (run first)**: `git diff --stat 5091ff1..HEAD -- src/db/ewcNewsPosts.js apps/web/src/lib/news.ts apps/web/src/lib/mcp-tools.ts apps/web/src/test/mcp-api.test.ts`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `5091ff1`, 2026-07-09

## Why this matters

An MCP search with both `gameSlug` and `mediaSlug` currently produces an
impossible SQL predicate, and locale filtering happens after each post was
already resolved in its default language. Agents can receive no results for a
valid media post or search English text when they explicitly asked for Arabic.
The fix must not alter the dashboard's intentional rule that a game-only list
excludes media-owned posts.

## Current state

```js
// src/db/ewcNewsPosts.js:251-258
if (gameSlug) {
  where.push(`game_slug = $${params.length}`, 'media_slug IS NULL');
}
if (mediaSlug) {
  where.push(`media_slug = $${params.length}`);
}
```

With both filters this becomes `game_slug = ? AND media_slug IS NULL AND
media_slug = ?`. Rows are hydrated with no locale argument at line 267, so
`hydrate` resolves the default locale. `mcp-tools.ts:175-186` then filters on
`post.locale` and searches the already-resolved title/summary/body.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused web test | `npm --workspace @esports-community-bot/web run test -- src/test/mcp-api.test.ts` | all pass |
| Bot tests | `npm test` | exit 0 |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

## Scope

**In scope**:

- `src/db/ewcNewsPosts.js`
- `apps/web/src/lib/news.ts`
- `apps/web/src/lib/mcp-tools.ts`
- `apps/web/src/test/mcp-api.test.ts`

**Out of scope**:

- Public news search behavior.
- Pagination or a general admin-news performance rewrite.
- Changing which owner controls authorization.
- Translation schema or fallback policy.

## Git workflow

- Branch: `codex/071-fix-mcp-news-search`
- Commit example: `Fix scoped MCP news search filters`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Extend the admin list query without breaking dashboard callers

Add an optional `locale` argument to `listEwcNewsPostsForAdmin` and pass it to
`hydrate(row, locale)`.

Define filter semantics explicitly:

- `gameSlug` only: `game_slug = $n AND media_slug IS NULL` (unchanged).
- `mediaSlug` only: `media_slug = $n` (unchanged).
- both: `game_slug = $n AND media_slug = $m`; do not add `media_slug IS NULL`.
- neither: all posts (unchanged, for super-admin listing).

Implement the branch deliberately rather than independently appending all
clauses. Keep all values parameterized with distinct `$n` placeholders for
SQLite/Postgres compatibility.

Update the typed wrapper in `apps/web/src/lib/news.ts` to accept `locale?:
Locale`.

**Verify**: web lint exits 0.

### Step 2: Resolve the requested locale before searching

Pass the MCP `locale` argument into `listAdminNewsPosts`. Remove the post-hoc
`.filter((post) => !locale || post.locale === locale)`; hydration labels the
requested locale even when the content falls back, so that filter is not a
translation-existence test.

Search `title`, `summary`, and `body` from the locale-resolved projection. Keep
scope filtering before output, and retain status/EWC/limit behavior.

**Verify**: focused MCP tests pass.

### Step 3: Characterize all filter combinations and translations

Seed in `mcp-api.test.ts`:

- a game-owned post;
- a media-owned post related to the same game;
- another media post for a different game;
- a translated English/Arabic post with distinct searchable phrases.

Assert:

- game-only returns only game-owned content;
- media-only returns that channel's content;
- combined game+media returns only related rows for that pair;
- Arabic query finds Arabic text and returns Arabic fields;
- English query finds English text;
- an out-of-scope media owner is never returned even if its related game is in
  scope;
- status and `ewcOnly` still compose with these filters.

**Verify**: focused test passes and would fail with the old impossible SQL.

## Test plan

- Four owner-filter combinations: neither, game only, media only, and both.
- English and Arabic searches use distinct phrases to prove requested-locale
  projection rather than merely checking the `locale` label.
- Game-only admin listing retains its media exclusion.
- Media ownership controls scope even when a related game is allowed.
- Status, EWC-only, query, and limit filters still compose.
- Use the real SQLite test DB; do not mock SQL construction.

## Done criteria

- [ ] Every documented game/media filter combination has defined SQL semantics.
- [ ] Dashboard game-only lists still exclude media-owned posts.
- [ ] MCP searches the requested localized projection.
- [ ] Scope checks remain owner-based.
- [ ] SQL remains parameterized and dual-backend compatible.
- [ ] All required repo checks pass.
- [ ] Plan 071 is marked DONE.

## STOP conditions

- A current dashboard caller intentionally passes both filters with different
  expected semantics; report the caller before changing SQL.
- Locale hydration requires a schema change.
- Fixing the query would alter public feed ownership rules.
- A verification command fails twice.

## Maintenance notes

Treat `gameSlug` on a media post as a related-game tag, not ownership. Future
query options must preserve that distinction. If admin search later moves to a
dedicated SQL search endpoint, carry these four filter cases forward as
contract tests.
