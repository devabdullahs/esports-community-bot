# Plan 068: Keep MCP key verifier hashes server-private

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 5091ff1..HEAD -- src/db/mcpKeys.js apps/web/src/lib/mcp-keys.ts apps/web/src/app/api/admin/mcp-keys/route.ts tests/mcpKeys.test.mjs apps/web/src/test/mcp-key-admin-api.test.ts`
> If any in-scope file changed, compare the excerpts below with live code. A
> material mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `5091ff1`, 2026-07-09

## Why this matters

The database must retain a SHA-256 verifier for each bearer key, but that value
has no reason to cross into page props or JSON responses. Today TypeScript hides
`keyHash` only at compile time while object spreads preserve it at runtime. The
secret has high entropy, so this is not an emergency credential-rotation event,
but an authentication verifier should remain inside the DB module and the web
API should use an explicit allowlisted DTO.

## Current state

- `src/db/mcpKeys.js:47-64` hydrates every row with `keyHash`.
- `apps/web/src/lib/mcp-keys.ts:29-40` type-casts DB results to `McpKey`; a cast
  does not remove runtime properties.
- `apps/web/src/app/api/admin/mcp-keys/route.ts:42-47` returns `{ ...key }`, so
  all current and future DB fields are serialized.
- `apps/web/src/app/admin/mcp/page.tsx:24-31` also loads these objects into page
  props.
- `apps/web/src/test/mcp-key-admin-api.test.ts:113-119` uses `toMatchObject`,
  which permits undisclosed extra fields.

Relevant code today:

```js
// src/db/mcpKeys.js:47-53
function hydrate(row) {
  return {
    id: Number(row.id),
    keyHash: row.key_hash,
    keyPrefix: row.key_prefix,
```

```ts
// apps/web/src/app/api/admin/mcp-keys/route.ts:42-47
function publicKey(key: Awaited<ReturnType<typeof createMcpKey>>["key"]) {
  return {
    ...key,
    games: key.games.filter((scope) => scope !== MCP_NO_SCOPE_SENTINEL),
    media: key.media.filter((scope) => scope !== MCP_NO_SCOPE_SENTINEL),
  };
}
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Bot key tests | `node --test tests/mcpKeys.test.mjs` | all tests pass |
| Web MCP-key tests | `npm --workspace @esports-community-bot/web run test -- src/test/mcp-key-admin-api.test.ts` | all tests pass |
| Full bot tests | `npm test` | exit 0 |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0, no errors |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all tests pass |
| Web build | `npm run web:build` | exit 0 |

## Scope

**In scope** (the only files to modify):

- `src/db/mcpKeys.js`
- `apps/web/src/lib/mcp-keys.ts`
- `apps/web/src/app/api/admin/mcp-keys/route.ts`
- `tests/mcpKeys.test.mjs`
- `apps/web/src/test/mcp-key-admin-api.test.ts`

**Out of scope**:

- Key format, hashing algorithm, expiry, revocation, and rate limiting.
- Database schema or existing key rotation.
- MCP tool authorization behavior.

## Git workflow

- Branch: `codex/068-protect-mcp-key-verifiers`
- Use focused commits such as `Keep MCP key hashes server-private`.
- Do not push or open a PR unless the operator asks.

## Steps

### Step 1: Split stored rows from safe key metadata

In `src/db/mcpKeys.js`, rename the current hydrator to make its private nature
obvious, for example `hydrateStoredKey`. Add a `safeKeyMetadata(stored)` helper
that explicitly returns only:

`id`, `keyPrefix`, `label`, `ownerDiscordId`, `ownerName`, `tools`, `games`,
`media`, `expiresAt`, `revokedAt`, `lastUsedAt`, `createdBy`, and `createdAt`.

Keep `keyHash` available only inside the module for constant-time verification.
Make `getMcpKeyByHash` private because no external caller uses it. Ensure every
public export (`createMcpKey`, `listMcpKeys`, `getMcpKey`, and
`verifyMcpKeySecret`) returns safe metadata without `keyHash`.

Do not weaken this check:

```js
timingSafeHashEqual(stored.keyHash, candidateHash)
```

**Verify**: `node --test tests/mcpKeys.test.mjs` -> all tests pass.

### Step 2: Replace the web object spread with an allowlisted DTO

In `apps/web/src/lib/mcp-keys.ts`, add and export a function such as
`toMcpKeyDto(value): McpKey`. It must construct the object field by field; do not
use a spread. Keep scope-sentinel removal either in this mapper or in a second
explicit mapper in the route.

Update `publicKey` in the admin route to call the mapper and never spread a DB
record. This is defense in depth: a future field added to the DB record must not
silently become API output.

**Verify**: `npm --workspace @esports-community-bot/web run lint` -> exit 0.

### Step 3: Add exact-shape regression tests

In `tests/mcpKeys.test.mjs`, assert that values returned by create, list, get,
and verify do not own a `keyHash` property. Keep the existing verification,
expiry, revocation, and last-used assertions.

In `apps/web/src/test/mcp-key-admin-api.test.ts`, replace the permissive key
response assertion with an exact key set assertion (for example
`Object.keys(body.key).sort()`) and explicitly assert that `keyHash` and
`key_hash` are absent from both POST and GET JSON. The one-time `secret` remains
present only in the successful POST response.

**Verify**: `npm --workspace @esports-community-bot/web run test -- src/test/mcp-key-admin-api.test.ts` -> all tests pass and the test fails if `...key` is restored.

## Test plan

- Safe metadata from all DB exports omits the verifier.
- A valid secret still verifies; invalid, revoked, and expired secrets still fail.
- POST returns the one-time secret but no verifier.
- GET returns metadata only and never returns a secret or verifier.
- Scoped-owner visibility and sentinel filtering remain unchanged.

## Done criteria

- [ ] No exported MCP key metadata object contains `keyHash`.
- [ ] The verifier remains available only inside `src/db/mcpKeys.js`.
- [ ] Admin MCP-key API tests assert exact response fields.
- [ ] All four required repo checks pass.
- [ ] No file outside the in-scope list is modified.
- [ ] Plan 068 is marked DONE in `plans/README.md`.

## STOP conditions

- Another module outside `src/db/mcpKeys.js` now legitimately consumes
  `keyHash`; report the caller and stop rather than exposing the field again.
- The live API has a documented client dependency on an unlisted response
  field; report it before changing the DTO.
- A verification command fails twice after a reasonable fix attempt.

## Maintenance notes

Treat DB authentication rows as private by default. Any future admin API field
must be deliberately added to both `McpKey` and `toMcpKeyDto`, with a test that
names it. Reviewers should reject future object spreads over authentication
records.

