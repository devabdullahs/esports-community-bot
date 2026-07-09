# Plan 070: Apply canonical news validation to MCP-created drafts

> **Executor instructions**: Execute each step and verification in order. Do
> not loosen dashboard validation to accommodate MCP input. Update the plan row
> in `plans/README.md` after completion.
>
> **Drift check (run first)**: `git diff --stat 5091ff1..HEAD -- apps/web/src/lib/mcp-tools.ts apps/web/src/lib/news-validation.ts apps/web/src/app/api/admin/news/route.ts apps/web/src/test/mcp-api.test.ts`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `5091ff1`, 2026-07-09

## Why this matters

`create_news_draft` currently accepts more text than the dashboard and inserts
owner slugs without confirming those entities exist. It can therefore create a
draft that the normal editor cannot save or an orphaned post with no valid
owner page. MCP must use the same content limits and ownership existence rules
as `POST /api/admin/news`, while remaining draft-only.

## Current state

```ts
// apps/web/src/lib/mcp-tools.ts:323-340
title: z.string().min(1).max(140),
summary: z.string().max(280).optional(),
body: z.string().max(20000).optional(),
// ...
const post = await createNewsPost({
```

Canonical limits are `90`, `180`, and `12000` in
`src/lib/ewcNewsContent.js:1-3`. `validateNewsInput` in
`apps/web/src/lib/news-validation.ts:39-140` already applies those limits and
normalizes ownership/content. The normal admin route additionally checks the
media channel and optional related game, or the owning game, at
`apps/web/src/app/api/admin/news/route.ts:47-71`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused test | `npm --workspace @esports-community-bot/web run test -- src/test/mcp-api.test.ts` | all pass |
| Bot tests | `npm test` | exit 0 |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

## Scope

**In scope**:

- `apps/web/src/lib/mcp-tools.ts`
- `apps/web/src/test/mcp-api.test.ts`

**Out of scope**:

- Publishing through MCP; the tool must always create `status: "draft"`.
- New cover image, author picker, scheduling, or update tools.
- Changing canonical dashboard limits.
- Transaction/idempotency work, which belongs to plan 072.

## Git workflow

- Branch: `codex/070-validate-mcp-news-drafts`
- Commit example: `Validate MCP news drafts like dashboard posts`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Make the MCP schema advertise canonical limits

Import `NEWS_TITLE_MAX_LENGTH`, `NEWS_SUMMARY_MAX_LENGTH`, and
`NEWS_BODY_MAX_LENGTH` from `@/lib/news-validation`. Replace the numeric Zod
limits with those constants. Keep title required; summary/body may remain blank
because drafts are allowed to be incomplete.

**Verify**: web lint exits 0.

### Step 2: Run the payload through `validateNewsInput`

Build the same normalized shape the editor sends:

```ts
{
  gameSlug,
  mediaSlug,
  contentMode: "shared",
  defaultLocale: locale,
  translations: { [locale]: { title, summary, body } },
  status: "draft",
  ewc,
}
```

Call `validateNewsInput` before any DB write. Convert a failed result to an MCP
`errorResult` with its canonical error. Pass `validated.value` to
`createNewsPost`, overriding only server-authoritative author fields. Never
trust client-supplied author identity.

**Verify**: focused MCP test passes.

### Step 3: Validate owner entities before authorization and insert

Mirror the normal route's ownership rules using `getGame` and
`getMediaChannel`:

- Media post: media channel must exist and be in key scope; an optional related
  game must exist, but media ownership controls authorization.
- Game post: game is required, must exist, and must be in key scope.

Return specific MCP errors such as `Unknown media channel` or `Unknown game`.
Do not reveal whether an existing entity is outside scope beyond the existing
`cannot draft` wording.

**Verify**: focused MCP test passes.

### Step 4: Add regression cases

Extend `mcp-api.test.ts` with:

- exact maximum title/summary/body accepted;
- one character over each maximum rejected and no row inserted;
- unknown owning game rejected and no row inserted;
- unknown media channel rejected and no row inserted;
- media post with unknown related game rejected;
- valid incomplete draft created as `draft` with the key owner as author;
- valid media-owned draft may include a related game without requiring game
  management permission.

Count rows before/after rejected calls so tests prove the handler has no partial
write.

**Verify**: focused MCP test passes, including all new cases.

## Test plan

- Boundary tests for exactly-at-limit and one-over-limit title, summary, and body.
- Valid game-owned and media-owned draft creation.
- Unknown game, unknown media channel, and unknown related game rejection.
- Scope denial remains an MCP error and creates no post/audit row.
- Result remains `draft` and uses server-authoritative owner identity.
- Model the new cases after the existing scoped draft tests in
  `apps/web/src/test/mcp-api.test.ts:240-257`.

## Done criteria

- [ ] MCP and dashboard use the same news content limits.
- [ ] No MCP draft can reference a missing game or media owner.
- [ ] Media ownership semantics match the normal admin route.
- [ ] MCP still cannot publish directly.
- [ ] Rejected input creates no post or audit row.
- [ ] All required repo checks pass.
- [ ] Plan 070 is marked DONE.

## STOP conditions

- `validateNewsInput` no longer accepts the documented shared-translation shape.
- Normal admin-route ownership semantics changed since `5091ff1`.
- Correctness appears to require changing canonical limits or public post shape.
- A verification command fails twice.

## Maintenance notes

Whenever the normal news validator changes, MCP tests should exercise the same
boundary values. Plan 072 later wraps the validated write and audit receipt in
one transaction; do not preempt that work here.
