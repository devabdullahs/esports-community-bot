# Plan 073: Let admin MCP clients discover usable scopes and resource IDs

> **Executor instructions**: Implement only safe self-discovery for the current
> key. Do not expose the admin roster, other owners, secrets, or raw DB rows.
> Run every verification and update `plans/README.md` when complete.
>
> **Drift check (run first)**: `git diff --stat 5091ff1..HEAD -- src/lib/mcpToolManifest.js apps/web/src/lib/mcp-tools.ts apps/web/src/lib/mcp-auth.ts apps/web/src/lib/stream-channels.ts apps/web/src/test/mcp-api.test.ts apps/web/src/lib/admin-mcp-copy-page.ts`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plan 069
- **Category**: dx
- **Planned at**: commit `5091ff1`, 2026-07-09

## Why this matters

The write tools require identifiers an AI client cannot reliably discover.
`create_news_draft` needs a media slug but admin MCP has no media directory,
and `update_stream_channel` needs the numeric row ID omitted from public
co-stream projections. A key-scoped discovery tool lets an assistant form valid
calls without guessing or scraping the dashboard.

## Current state

- `apps/web/src/lib/mcp-tools.ts:367` requires numeric stream `id`.
- `apps/web/src/lib/public-mcp-tools.ts:202-238` returns a grouped string ID and
  omits each channel's numeric DB ID.
- `list_games` discovers public game slugs, but no admin tool lists the key's
  media slugs or granted write capabilities.
- `streamAllowed` at `mcp-tools.ts:77-83` already expresses which stream rows a
  key may update and should remain the authorization source.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused MCP test | `npm --workspace @esports-community-bot/web run test -- src/test/mcp-api.test.ts` | all pass |
| Bot tests | `npm test` | exit 0 |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

## Scope

**In scope**:

- `src/lib/mcpToolManifest.js`
- `apps/web/src/lib/mcp-tools.ts`
- `apps/web/src/lib/stream-channels.ts`
- `apps/web/src/lib/admin-mcp-copy-page.ts` (only if plan 069's generator needs a section intro)
- `apps/web/src/test/mcp-api.test.ts`
- `apps/web/src/test/mcp-tool-manifest.test.ts`

**Out of scope**:

- Public MCP changes.
- Listing other admins, keys, sessions, audit rows, or moderation data.
- Exposing raw Liquipedia/enrichment payloads.
- Expanding stream update authorization beyond existing `streamAllowed` rules.

## Git workflow

- Branch: `codex/073-mcp-capability-discovery`
- Commit example: `Add scoped MCP capability discovery`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add an always-on admin discovery capability

Add `get_admin_capabilities` to the shared manifest with:

- admin surface only;
- read kind;
- `adminGrant: 'always'`;
- no external scope requirement because its output is already the effective
  scope of the authenticated key.

It must not be shown as a selectable permission in the key form.

**Verify**: manifest drift tests pass.

### Step 2: Register a safe projection

Register `get_admin_capabilities` in `createAdminMcpServer`. Return:

- localized/neutral game entries: `slug`, `title`;
- media entries: `slug`, `name`, optional related `gameSlug`;
- effective tool entries from the manifest: `name`, `kind`, `scope`, and whether
  they are always available or explicitly granted;
- writable stream rows: `id`, `platform`, `handle`, `label`, `scope`,
  `creatorKey`, `gameSlugs`, `active`, and `isDefault`.

For non-super keys, filter games/media through `canMcpManageGame` and
`canMcpManageMedia`, and stream rows through the existing `streamAllowed`.
For super keys, all current resources may be returned. Never return `addedBy`,
owner Discord IDs, bearer metadata, live API payloads, or unrelated scope rows.

Use `listStreamChannels` through the typed wrapper. Keep the response bounded;
if stream rows can exceed 200, accept `limit`/`offset` capped at 100 and return a
total.

**Verify**: focused MCP tests pass.

### Step 3: Make write schemas point clients to discovery

Update descriptions for `create_news_draft` and `update_stream_channel` to tell
clients to call `get_admin_capabilities` for valid slugs and IDs. Keep input
schemas otherwise unchanged except for plan 072's idempotency field if that
plan has landed.

The generated admin docs should automatically include the new tool. Add one
short workflow example: discover, select an allowed resource, then draft/update.

**Verify**: docs/assistant-link tests and build pass.

### Step 4: Add a negative authorization matrix

Test super and scoped keys. For a scoped key, assert:

- only assigned game/media slugs appear;
- only update-authorized game stream rows appear;
- an EWC/team/match or other-game stream row is absent under current rules;
- no field named `keyHash`, `secret`, `token`, `addedBy`, or
  `ownerDiscordId` appears recursively;
- the tool works even when it was not selected at key creation;
- deprovisioning the owner still blocks MCP before discovery runs.

**Verify**: focused MCP tests pass.

## Test plan

- `tools/list` contains discovery on admin MCP and not public MCP.
- Discovery works without an explicit key grant because it is admin-always.
- Scoped key receives only effective game/media resources and writable stream IDs.
- Super key receives all safe resources.
- Recursive forbidden-field assertion covers key/auth/private DB names.
- Deprovisioned owner and invalid/revoked key fail before the handler.
- Existing write authorization tests remain green so discovery does not broaden
  what `update_stream_channel` can mutate.

## Done criteria

- [ ] Agents can discover valid game/media slugs and writable stream numeric IDs.
- [ ] Discovery output is the authenticated key's effective access, not owner configuration in isolation.
- [ ] The tool is always available on admin MCP and absent from public MCP.
- [ ] No private identity, key, or raw payload fields are exposed.
- [ ] All required repo checks pass.
- [ ] Plan 073 is marked DONE.

## STOP conditions

- Listing stream rows requires bypassing `streamAllowed`.
- The shared manifest from plan 069 is missing or materially different.
- A safe bounded projection cannot be made without exposing raw DB rows.
- Any resource type lacks a stable public/admin identifier.

## Maintenance notes

Whenever a write tool adds a required identifier, add that identifier to this
discovery projection in the same PR. Keep the output intentionally boring and
structured; it is an agent capability map, not an admin data export.
