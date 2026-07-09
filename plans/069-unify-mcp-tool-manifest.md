# Plan 069: Derive MCP permissions, UI, tests, and docs from one tool manifest

> **Executor instructions**: Follow this plan step by step and run every
> verification. Stop on any listed STOP condition; do not invent a migration or
> silently change tool authorization. Update this plan's row in
> `plans/README.md` when complete.
>
> **Drift check (run first)**: `git diff --stat 5091ff1..HEAD -- src/db/mcpKeys.js apps/web/src/lib/mcp-tools.ts apps/web/src/lib/public-mcp-tools.ts apps/web/src/lib/mcp-auth.ts apps/web/src/app/api/admin/mcp-keys/route.ts apps/web/src/app/admin/mcp/page.tsx apps/web/src/lib/admin-mcp-copy-page.ts apps/web/src/lib/public-mcp-copy-page.ts docs/ADMIN_MCP.md README.md`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plan 068
- **Category**: tech-debt
- **Planned at**: commit `5091ff1`, 2026-07-09

## Why this matters

Tool names and capabilities currently live in several arrays, registration
calls, UI props, and two sets of documentation. They already disagree: six
public tools are always available through the admin endpoint even when they are
not selected on the key, while the UI presents one undifferentiated tool list.
A shared manifest makes the authorization model explicit and gives tests a
single contract against which registrations, UI choices, and bilingual docs
can be checked.

## Current state

- `src/db/mcpKeys.js:4-18` defines `MCP_TOOL_NAMES` manually.
- `apps/web/src/lib/public-mcp-tools.ts:44-64` defines two more arrays.
- `apps/web/src/lib/mcp-tools.ts:89-94` defines the overlap list.
- `apps/web/src/test/mcp-api.test.ts:122-155` proves public-only tools are
  callable through admin MCP even if the key selected only `get_site_overview`.
- `apps/web/src/lib/admin-mcp-copy-page.ts:50-66` and
  `apps/web/src/lib/public-mcp-copy-page.ts:39-50` manually list tools.
- `docs/ADMIN_MCP.md:7-8,61-75` still describes public MCP as future work,
  super-only key creation, and empty scopes as inheritance. All three are stale.

The intended v1 semantics to encode are:

1. Public endpoint tools are read-only.
2. Admin MCP includes public tools, so admins configure only one endpoint.
3. Public-only tools on the admin endpoint are always available.
4. Admin-enriched reads and writes require an explicit key grant.
5. Game/media scope checks remain in handlers and owner permissions are still
   intersected at request time.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused MCP tests | `npm --workspace @esports-community-bot/web run test -- src/test/mcp-api.test.ts src/test/public-mcp-api.test.ts src/test/mcp-key-admin-api.test.ts src/test/mcp-assistant-links.test.ts` | all pass |
| Bot tests | `npm test` | exit 0 |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

## Suggested executor toolkit

- Use the `shadcn` skill only to check Base UI component conventions when the
  manifest reaches the key UI. Do not redesign the key form in this plan; plan
  075 owns that work.

## Scope

**In scope**:

- `src/lib/mcpToolManifest.js` (new)
- `src/db/mcpKeys.js`
- `apps/web/src/lib/mcp-tool-manifest.ts` (new typed boundary)
- `apps/web/src/lib/mcp-keys.ts`
- `apps/web/src/lib/mcp-auth.ts`
- `apps/web/src/lib/mcp-tools.ts`
- `apps/web/src/lib/public-mcp-tools.ts`
- `apps/web/src/app/api/admin/mcp-keys/route.ts`
- `apps/web/src/app/admin/mcp/page.tsx`
- `apps/web/src/lib/admin-mcp-copy-page.ts`
- `apps/web/src/lib/public-mcp-copy-page.ts`
- `docs/ADMIN_MCP.md`
- `README.md`
- `apps/web/src/test/mcp-tool-manifest.test.ts` (new)
- `apps/web/src/test/mcp-api.test.ts`
- `apps/web/src/test/public-mcp-api.test.ts`
- `apps/web/src/test/mcp-key-admin-api.test.ts`
- `apps/web/src/test/mcp-assistant-links.test.ts`

**Out of scope**:

- Adding, removing, or renaming an MCP tool.
- Changing a tool input/output schema or handler behavior.
- Migrating existing key rows.
- The key-form redesign (plan 075) and capability discovery tool (plan 073).

## Git workflow

- Branch: `codex/069-unify-mcp-tool-manifest`
- Commit example: `Unify MCP tool capability metadata`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Create a runtime-neutral shared manifest

Create `src/lib/mcpToolManifest.js` with one frozen entry per existing tool.
Each entry must include at least:

```js
{
  name: 'list_games',
  surfaces: ['public', 'admin'],
  kind: 'read',
  adminGrant: 'always', // or 'selectable'
  scope: 'none', // none | game | media | game-or-media | stream-game
  title: { en: 'List games', ar: '...' },
  description: { en: '...', ar: '...' },
}
```

Use these classifications:

- `adminGrant: 'always'`: the six current public-only admin tools
  (`list_games`, `list_tournaments`, `list_co_streams`, `search_teams`,
  `search_players`, `get_public_ewc_leaderboard`).
- `adminGrant: 'selectable'`: the four admin/public overlap tools plus
  `list_admin_queue`, `create_news_draft`, and `update_stream_channel`.
- `kind: 'write'`: only `create_news_draft` and `update_stream_channel`.

Export derived arrays for public, admin, always-on admin, and selectable admin
tools. Keep this module free of `server-only`, React, Next.js, DB imports, and
MCP SDK imports so both workspaces can consume it.

**Verify**: `node -e "import('./src/lib/mcpToolManifest.js').then(m => console.log(m.MCP_TOOL_MANIFEST.length))"` -> prints `13`.

### Step 2: Replace hand-maintained name arrays

Import the derived arrays in `src/db/mcpKeys.js` and preserve the exported
`MCP_TOOL_NAMES` compatibility name. In the web app, add a typed wrapper in
`mcp-tool-manifest.ts` and derive:

- `PUBLIC_MCP_TOOL_NAMES`
- `PUBLIC_ONLY_MCP_TOOL_NAMES`
- `ADMIN_PUBLIC_OVERLAP_TOOL_NAMES`
- key-form selectable tools

Do not change which handlers call `assertTool`. Do not make always-on public
tools selectable. Existing rows that contain old public tool names remain
valid and require no migration.

Update the key POST route to accept only selectable tool names. Continue to
reject a key with zero selectable tools for now; plan 075 may change that UX
only if product behavior is explicitly updated.

**Verify**: focused MCP tests -> all pass with unchanged authorization behavior.

### Step 3: Generate tool documentation sections from the manifest

Refactor both copy-page modules so the surrounding setup text stays authored,
but the tool list is generated from localized manifest entries. Public docs
include public-surface entries; admin docs include admin-surface entries and
label always-on versus key-selected behavior clearly.

Correct `docs/ADMIN_MCP.md` to match production:

- Public MCP already exists at `/api/public-mcp`.
- Any approved signed-in admin can create keys only for their own account.
- Super admins may view and revoke all keys.
- Empty selected game/media scopes are stored as no scope, not inheritance.
- Admin MCP contains all public reads.

Update the README link text so website users are directed first to
`/docs/admin-mcp`; retain the repo guide as maintainer documentation, not as the
only user-facing guide.

**Verify**: `npm --workspace @esports-community-bot/web run test -- src/test/mcp-assistant-links.test.ts` -> all pass.

### Step 4: Add drift tests

Create `mcp-tool-manifest.test.ts` that asserts:

- names are unique;
- every tool has English and Arabic title/description;
- only read tools appear on the public surface;
- only write tools are classified as writes;
- expected `tools/list` names from both endpoints equal the derived sets;
- selectable names returned by the key API equal the manifest's selectable set;
- generated English and Arabic docs mention every applicable tool exactly once.

Use actual `tools/list` endpoint tests for registration coverage; do not parse
source text or regex `registerTool` calls.

**Verify**: all focused MCP tests pass.

## Test plan

- Characterize public and admin `tools/list` exact sets.
- Preserve the existing guarantee that public-only reads work through admin MCP
  without a second configuration.
- Prove unselected admin tools still fail authorization.
- Prove public surface contains no write tool.
- Prove generated docs and key selector cannot drift from the manifest.

## Done criteria

- [ ] One manifest owns every MCP tool name and capability classification.
- [ ] No duplicate hard-coded tool-name arrays remain.
- [ ] The key API exposes only selectable tools.
- [ ] English/Arabic docs are generated from the manifest and stale repo docs are corrected.
- [ ] Existing key rows continue to verify without a migration.
- [ ] All required repo checks pass.
- [ ] Plan 069 is marked DONE.

## STOP conditions

- Existing persisted keys use a tool name not represented by the current 13
  names; report the name and usage before filtering it.
- A handler's real authorization semantics contradict the classification above.
- Sharing the manifest would require importing Next.js code into `src/`.
- A focused test shows this plan changes a tool's input/output behavior.

## Maintenance notes

New MCP tools must be added to the manifest first, then registered and tested.
Reviewers should treat the drift test as the contract. Plan 073 will add one
admin-only always-on discovery tool after this foundation lands.

