# Plan 139: Make API authorization coverage complete and object-aware

> **Executor instructions**: Build a route/method policy inventory that fails CI
> when a protected API is unclassified, then add executable negative tests for
> authentication, function-level authorization, object scope, and ownership.
> Do not weaken existing route checks to make the matrix easier to satisfy.
>
> **Drift check (run first)**:
> `git diff --stat d1b66e1..HEAD -- apps/web/src/app/api apps/web/src/lib/admin.ts apps/web/src/lib/community.ts apps/web/src/lib/mcp-auth.ts apps/web/src/test`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: LOW
- **Depends on**: 137 for final internal-capability entries
- **Category**: security
- **Planned at**: commit `d1b66e1`, 2026-07-24

## Why this matters

The incident's damaging endpoints accepted an object identifier and performed
sensitive actions without proving that the caller could act on that object.
OWASP classifies this as broken object-level or function-level authorization
and recommends authorization checks, plus regression tests, in every function
that accesses a record using a client-provided ID.

This repository's inspected routes do have application-side checks, and
cross-game/media tests exist. The coverage claim has drifted, however:
`admin-authz.test.ts` imports only the original admin surface while the current
tree contains many later partner, stream, prediction, graphics, comment, MCP,
and analytics routes. A new endpoint can therefore miss the "all handlers"
matrix without CI noticing.

## Current state

- There are 77 `apps/web/src/app/api/**/route.ts` files, including 34 under
  `/api/admin`.
- `apps/web/src/test/admin-authz.test.ts:96-112` directly imports only the
  older game/media/news/team/author routes (plus the user-block route later).
  Its suites still say "every handler" at lines 165 and 208.
- The current admin source scan found `getAdminAccess()` in all 34 admin route
  files; no confirmed public admin bypass was found.
- Existing scope tests cover cross-game/media news and editor operations.
- Later super-only operations and intentional global moderation have separate
  tests or comments, but no inventory gate proves that every route/method has a
  policy and negative test.
- Member routes generally derive identity from the server session or verified
  Discord membership. This important property should be explicit and tested
  whenever a body/path also contains an object ID.
- Plan 137 owns route-specific internal service capabilities; this plan records
  and tests them in the complete inventory.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Inventory coverage | `npm --workspace @esports-community-bot/web run test -- src/test/api-authorization-inventory.test.ts` | every route+method classified |
| Admin matrix | `npm --workspace @esports-community-bot/web run test -- src/test/admin-authz.test.ts` | all protected admin methods covered |
| Member isolation | `npm --workspace @esports-community-bot/web run test -- src/test/member-object-authz.test.ts` | cross-member/object cases fail closed |
| Internal/MCP matrices | `npm --workspace @esports-community-bot/web run test -- src/test/internal-auth.test.ts src/test/mcp-tool-manifest.test.ts` | capability/scope cases pass |
| Route count sanity | `(Get-ChildItem -Recurse apps/web/src/app/api -Filter route.ts).Count` | matches inventory discovery output |
| Bot suite | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Native typecheck | `npm --workspace @esports-community-bot/web run typecheck:native` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

## Scope

**In scope**:

- Method-level classification of all web API route files.
- Executable negative authorization tests for protected methods.
- Object/scope/ownership cases for admin, member, internal, and MCP actors.
- A CI gate that detects new or removed route methods.
- Small shared test helpers or production authorization helpers when they
  remove duplicated, inconsistent checks.

**Out of scope**:

- Changing the product's intentional policy that every allowed admin is a
  global comment moderator.
- Multi-guild/tenant authorization.
- A framework rewrite, external policy engine, or generated OpenAPI document.
- Treating random IDs, rate limits, or hidden documentation as authorization.

## Git workflow

- Branch: `codex/139-complete-api-authz-matrix`
- Commit style: `test(security): complete API authorization matrix`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Build a route/method policy inventory

Add a typed, test-owned manifest keyed by source route and exported HTTP
method. Classify every method as one of:

- deliberately public;
- authenticated session/self;
- verified guild member/self or owned record;
- allowed admin/global moderation;
- game-scoped admin;
- media-scoped admin;
- super-admin;
- internal named capability;
- admin MCP key/tool/resource scope;
- public MCP/read-only.

For methods that receive an object ID in the path, query, or body, record the
authoritative relationship used to authorize it: owner Discord/auth user,
parent game/media slug, configured guild, super-only operation, or explicit
global-moderator policy.

Use the TypeScript compiler API already present in the workspace (or an equally
robust AST method) to discover exported route methods. Fail when a route/method
is missing from the manifest, a manifest entry has no source method, or a
protected entry lacks an executable negative-test fixture. Do not rely on a
fragile grep count as the gate.

### Step 2: Make negative authentication coverage truly complete

Refactor/extend the current matrix so every protected route method proves its
unauthenticated result before parsing or data access. Authentication fixtures
must include the route's trusted/same-origin context so they reach the auth
decision:

- session/admin endpoints: 401;
- authenticated non-admin against admin methods: 403;
- internal capabilities: 401 for missing/wrong credentials;
- MCP: 401 for missing/invalid key and 403 for disallowed origin/scope.

In a separate CSRF matrix for browser mutations, assert cross-origin and
missing-Origin rejection returns 403 before authentication is invoked. Do not
use those requests as the unauthenticated 401 fixtures. Keep internal
server-to-server and MCP origin semantics separate rather than forcing them
through the browser CSRF helper.

The inventory test must fail when a future protected method has no invocation
fixture, preventing the matrix from silently becoming stale again.

### Step 3: Cover function-level authorization tiers

Add table-driven cases for every super-only method, including later partner,
campaign, inquiry, stream, prediction retry/operations, team, bulk moderation,
keyword-rule, and other destructive/operational routes. A scoped admin must
receive 403.

For intentionally allowed-admin/global operations—currently single-comment
moderation, moderation queue reads, generic asset upload, and selected graphics
functions—record that policy explicitly and test one scoped admin happy path.
This prevents an executor from "fixing" an intentional policy or accidentally
expanding a super-only operation to all admins.

### Step 4: Cover object-level and reassignment authorization

For each object-bearing protected method, seed at least two neighboring
objects/users and assert:

- an owner/member can read or mutate only their object;
- a game/media admin cannot read or mutate the neighboring scope;
- update requests cannot authorize the old scope and then reassign into a new
  unauthorized scope;
- delete/retry/block/moderate actions re-read the stored target before acting;
- unknown and unauthorized resources use the intended non-enumerating 403/404
  behavior;
- bulk operations validate every target before committing and do not partially
  mutate an authorized subset.

Prioritize destructive/high-impact paths: user block, prediction retry,
partner/campaign mutation, stream mutation, news status/delete, MCP key
revocation, comment bulk moderation, session-bound EWC profile unlink, and
prediction mini-league ownership.

### Step 5: Prove identity comes from trusted context

For member/self routes, vary any client-provided Discord/auth user/object ID
while holding the authenticated session constant. Assert the route either
rejects the mismatch or ignores the supplied identity and uses the
server-derived member.

For internal routes, use plan 137's capability matrix and configured-guild
pinning. Assert that there is no internal/service-authorized unlink route.
For `/api/me/ewc/unlink`, prove the target is derived from the authenticated
Better Auth/Discord account, a caller-selected Discord/auth user ID is rejected
or ignored, and one member cannot unlink a neighboring seeded profile. For MCP,
assert current owner roster/scope is re-evaluated at use time and that a key
cannot exceed its owner's current game/media/tool permissions.

Random/unpredictable IDs may remain defense in depth, but tests must pass even
when the attacker knows a real neighboring ID.

### Step 6: Add maintenance rules and run all gates

Document the manifest in `AGENTS.md` or the web README: any new route method
must declare a policy and add its negative/object fixture in the same change.
CI should run the inventory early enough to produce a clear missing-entry
failure.

Run all commands. Review failures as policy questions rather than updating
expected status codes mechanically. Any route whose intended authorization
cannot be determined is a STOP condition.

## Test plan

- AST-based source route/method discovery versus the policy manifest.
- Complete unauthenticated/non-admin/internal/MCP negative matrices.
- Cross-scope and cross-owner real-DB fixtures with neighboring records.
- Reassignment and bulk atomicity cases.
- Trusted-context identity mismatch cases.

## Done criteria

- [ ] Every API route method is classified.
- [ ] Every protected method has an executable unauthenticated test.
- [ ] Every admin method has the correct non-admin/tier test.
- [ ] Every client-supplied object ID with an applicable actor/resource
      relationship has an ownership/scope test; configured-guild, super-only,
      public, and documented global-operation policies are classified and
      tested according to their actual rule.
- [ ] Reassignment, bulk, and destructive operations fail closed and atomically.
- [ ] A newly added unclassified route method fails CI.
- [ ] All repository gates pass.

## STOP conditions

- A route's intended owner/scope policy is ambiguous; request a product/security
  decision rather than encoding the current accident.
- A negative test would need a real Discord, Cloudflare, CranL, or external API
  call; inject/mimic the boundary instead.
- Plan 137 has not finalized internal capability names; land its inventory
  entries after rebasing rather than preserving the shared-secret model.
- A test reveals a real authorization bypass. Stop this coverage-only plan,
  report it as a finding, and create a focused fix/verification change.

## Maintenance notes

The manifest is a review and test contract, not the authorization decision
point. Production routes must continue deriving identity and checking stored
resource relationships server-side. Keep public/global exceptions explicit and
small.

## Standards references

- OWASP API1:2023 Broken Object Level Authorization:
  <https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/>
- OWASP API Security Top 10 (BOLA/BFLA/inventory):
  <https://owasp.org/API-Security/editions/2023/en/0x11-t10/>
