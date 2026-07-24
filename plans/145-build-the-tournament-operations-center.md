# Plan 145: Build the tournament operations center

> **Executor instructions**: Build a narrow super-admin registry around the
> typed lifecycle/queue contract from plan 144. The page may inspect stored
> state and submit named operations; it must never fetch providers, accept an
> arbitrary internal target, or expose raw provider errors. Use the installed
> shadcn Base Nova components and existing admin shell.
>
> **Drift check (run first)**:
> `git diff --stat d1b66e1..HEAD -- apps/web/src/app/admin apps/web/src/app/api/admin apps/web/src/components/admin apps/web/src/lib/admin.ts apps/web/src/lib/admin-copy.ts apps/web/src/lib/admin-navigation-model.ts apps/web/src/lib/audit.ts apps/web/src/lib/request-body.ts src/db/tournaments.js src/db/tournamentSyncHealth.js src/db/ewcAdminAuditLog.js apps/web/src/test`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: 126, 139, 144
- **Category**: product/operations
- **Planned at**: commit `d1b66e1`, 2026-07-24

## Product boundary

This is a tournament registry and recovery surface, not a generic database
editor or score override CMS.

Super admins can:

- inspect active, pending, archived, and deactivated tournaments;
- stage a supported source for validation/activation;
- correct explicit operator-owned presentation metadata;
- queue schedule or standings recovery;
- archive, deactivate/hide, or reactivate with clear consequences;
- inspect durable request state and sanitized health.

They cannot:

- submit a URL for the server to fetch;
- choose an internal host/path/method;
- edit provider identity in place;
- manually alter match scores/statuses/standings;
- bypass the bot's provider queue or rate limits.

## Why this matters

Tournament management currently exists only as Discord commands. Adding a
tournament reports success before provider validation, removal has no
confirmation, active watchers may outlive deactivation, and the list stops at
25. The web source-health page can reveal a problem but cannot recover it.

Plan 144 supplies the safe operation boundary. This plan turns it into an
operator workflow with server-side super-admin authorization, durable audit
visibility, accessible confirmation, and shadcn-consistent states.

## Current state

- There is no `/admin/tournaments` route or tournament mutation API.
- `/admin/source-health` is a super-only, read-only table with filters.
- `apps/web/src/lib/admin-navigation-model.ts` has source health but no
  tournament registry.
- Adjacent admin routes demonstrate `sameOriginOr403`, `getAdminAccess`,
  `isSuper`, validation, audit, and cache revalidation.
- Plan 126 will make bounded mutation parsing the standard; plan 139 will make
  every new route/method and object relationship part of the authorization
  inventory.
- `FieldGroup`/`Field`, `InputGroup`, `Select`, `Combobox`, `Table`, `Badge`,
  `Alert`, `Empty`, `ConfirmDialog`, `Sheet`, `Skeleton`, and `Button` are
  installed in the Base Nova/RTL shadcn project.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Admin route tests | `npm --workspace @esports-community-bot/web run test -- admin-authz admin-source-health api-authorization-inventory` | all pass |
| Operations tests | `npm --workspace @esports-community-bot/web run test -- tournament-operations tournament-directory tournaments-api` | all pass |
| Bot suite | `npm test` | all pass |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Native typecheck | `npm --workspace @esports-community-bot/web run typecheck:native` | exit 0 |
| Web build | `npm run web:build` | exit 0 |
| Browser journey | `npm run web:e2e -- admin-tournament-operations.spec.ts` | new EN/AR registry workflow passes against a disposable DB/fake bot consumer |

## Scope

**In scope**:

- Super-only admin page, navigation, read models, and mutation routes.
- Filter/search/pagination for all lifecycle states.
- Add-by-supported-source through plan 144's validation queue.
- Safe presentation metadata ownership/provenance.
- Queued schedule/standings recovery and request status.
- Archive/deactivate/reactivate confirmation and effects.
- Audit, cache revalidation, authorization inventory, and object-negative tests.
- EN/AR, RTL, keyboard, responsive, pending, empty, failure, and success states.

**Out of scope**:

- Direct provider access from Next.js.
- Arbitrary URL/path forwarding.
- Match/result/standings overrides.
- Multi-guild roles or a new admin tier.
- Editing source/source ID in place.
- Replacing the existing admin shell/sidebar.

## Git workflow

- Branch: `codex/145-tournament-operations-center`
- Commit style: `feat(admin): add tournament operations center`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Define the server read model

Create a server-only paged query returning bounded fields:

- tournament ID, source enum, canonical source ID, effective display name;
- canonical game, EWC flag, active/archive state;
- match summary counts and most recent/upcoming time;
- independent schedule/standings health from plan 144;
- latest queued/running/failed operation with coarse code/timestamps.

Accept URL-backed lifecycle, game, source, health, search, and page filters.
Clamp page/search values and query by configured guild server-side. Do not
hydrate the full match history per row; use bounded aggregate queries or a
dedicated projection. Return no raw errors, credentials, provider payloads, or
internal operation details.

**Verify**: pagination and combined filters work against a high-cardinality
fixture without per-row history reads.

### Step 2: Add protected route contracts

Add only the routes required by the UI, using numeric IDs and named actions.
Every mutation must:

1. reject cross/missing origin via `sameOriginOr403`;
2. parse through plan 126's bounded JSON helper;
3. resolve `getAdminAccess` and require `isSuper` server-side;
4. re-read the target under the configured guild;
5. validate a closed schema/enum;
6. enqueue one plan 144 closed operation (never call the bot application
   service from Next.js);
7. return a bounded result/request ID;
8. record a sanitized audit event;
9. revalidate tournament/admin/source-health tags after success.

Register every method, object relation, and negative fixture in plan 139's
authorization inventory. Unknown or cross-guild IDs fail closed with the
repository's chosen non-enumerating status.

Do not implement a generic `{action, target}` proxy. Route code maps a closed
admin intent to one queue enum value and bounded target. Archive, deactivate,
and reactivate also travel through this queue because only the bot process can
coordinate its in-memory watchers.

### Step 3: Stage and validate new tournaments safely

Build an add form with:

- supported source selector;
- source URL or ID input parsed locally/server-side into a canonical source ID;
- optional canonical game selector;
- read-only preview of the normalized source/ID;
- submit to `validate_and_activate`.

Use `FieldGroup`/`Field`, `InputGroup`, `Select`/`Combobox`, inline `Alert`, and
`Button` with spinner/busy state. Do not use placeholder as the only label.

The route sends only source enum/source ID/game to plan 144. The UI shows
pending/running/succeeded/failed based on the durable request. It must not claim
the tournament is tracked before success. Duplicate source requests converge on
the existing/idempotent operation.

If the user pastes a supported URL, parse it into fields and discard the raw URL
before persistence/queueing.

### Step 4: Make metadata ownership explicit

Provider-owned identity is immutable in place. If display-name correction is a
required workflow, store a nullable `display_name_override` (or equivalent)
beside the provider value so later syncs cannot silently overwrite the
operator's choice. Clearing it returns to provider ownership.

Game and EWC classification must use canonical values and have explicit
ownership rules:

- if provider-derived, show that provenance;
- an operator override is visible, audited, and reversible;
- a future provider sync must not overwrite it silently.

Do not offer a free-form game field. Changing source/source ID requires staging
the corrected tournament and deactivating the mistaken one, preserving history
and auditability.

### Step 5: Compose the registry with shadcn

Add `/admin/tournaments` to the existing entity-aware sidebar. Compose:

- page header with counts and Add Tournament action;
- URL-backed `InputGroup` search and `Select`/`Combobox` filters;
- responsive `Table` for desktop and a deliberate compact row/card layout on
  narrow screens;
- `Badge` for lifecycle and schedule/standings health;
- expandable/detail `Sheet` for metadata and operation history;
- shadcn `Empty`, `Skeleton`, and `Alert` for no data/loading/failure;
- `ConfirmDialog` for archive, deactivate, reactivate, and metadata reset.

Avoid a modal for ordinary filtering, excessive pills, manual dark-mode
classes, raw `space-y-*` stacks where component `gap` composition is expected,
and button-inside-link nesting. Use Lucide icons from the configured library.

### Step 6: Close the recovery loop

For schedule and standings independently, show:

- last success/attempt;
- current sanitized state;
- whether an operation is pending/running;
- a Retry action only when allowed by plan 144.

Retry submits a named operation for the stored numeric tournament ID. Disable
duplicate actions using server idempotency, not client state alone. Rate-limit
or backoff states show a coarse delayed message; the UI must not promise an
immediate provider call.

Preserve `/admin/source-health` as a redirect or focused view into the same
read model so existing links/bookmarks do not break. Do not maintain a second
health implementation.

### Step 7: Make lifecycle consequences explicit

Use different labels, descriptions, and confirmation copy:

- **Archive**: event is complete; preserve public detail/history and stop sync.
- **Deactivate/hide**: source is mistaken/invalid; remove active discovery,
  stop watchers, keep reversible history.
- **Reactivate**: revalidate source before tracking resumes.

Confirmations name the tournament/source and consequence. Destructive actions
cannot be invoked by row-click ambiguity. Submission enqueues the matching
closed plan 144 lifecycle operation and shows its progress/request ID. The web
does not flip active/archive state directly or claim watcher cleanup completed.

Do not add permanent delete in this plan.

### Step 8: Add authorization, audit, and failure tests

Cover:

- anonymous 401, non-admin/scoped-admin 403, super success;
- cross-origin rejection before mutation;
- oversized/malformed body rejection;
- cross-guild/unknown ID and old-scope/new-scope reassignment failures;
- source path-confusion/host-lookalike parser corpus;
- duplicate submissions and double-click idempotency;
- audit fields contain IDs/enums only, never raw URL/error/body;
- cache revalidation after successful terminal operations only;
- provider/rate failure remains sanitized and recoverable.

No admin test may call a real provider. The web process should have no provider
client mock because it should have no provider call at all.

### Step 9: Validate EN/AR operator usability

Check desktop and 320-pixel layouts in both directions. All fields/actions need
visible labels, all dialogs restore focus, table/detail controls work by
keyboard, and status meaning cannot depend on color.

Add `apps/web/e2e/admin-tournament-operations.spec.ts` and run one
disposable-DB journey with the repository E2E runner plus a deterministic fake
bot consumer:

1. stage supported source;
2. observe pending -> success through a fake consumer;
3. filter/find it;
4. retry standings;
5. archive it;
6. reactivate/revalidate it;
7. inspect audit/operation history.

### Step 10: Run all gates

Run focused authorization/operations tests, full bot/web suites, lint, native
typecheck, build, and the admin browser journey. Verify source has no web-side
provider import and no raw target URL/path field.

## Test plan

- Bounded registry query with lifecycle/source/game/health filters.
- Complete super-only route/method/object authorization matrix.
- Supported URL normalization and confusion/lookalike rejection.
- Pending validation, sanitized failure, retry, and idempotent success.
- Metadata override provenance/reset.
- Archive/deactivate/reactivate confirmation and effects.
- Operation/audit fields contain only bounded identifiers.
- EN/AR, RTL, keyboard, focus restoration, and mobile admin journey.

## Done criteria

- [ ] Super admins can see every tournament lifecycle state beyond the old
  25-item Discord limit.
- [ ] New tournaments are presented as pending until provider validation.
- [ ] Schedule and standings recovery are independent and actionable.
- [ ] Archive/deactivate/reactivate meanings are clear and reversible.
- [ ] Provider identity cannot be edited or forwarded as an arbitrary path.
- [ ] Every mutation is same-origin, bounded, super-only, guild-scoped,
  object-tested, audited, and cache-revalidated.
- [ ] The UI uses installed shadcn components and semantic tokens.
- [ ] No web code calls a provider.
- [ ] All repository gates pass.

## STOP conditions

- Plans 126, 139, or 144 have not established their required parser,
  authorization-inventory, or operation contracts.
- A proposed route accepts an arbitrary URL/path/host/method or dispatches an
  unrecognized operation.
- A metadata edit would be silently overwritten by the next provider sync.
- Product direction asks for manual score/status/standings overrides; design
  provenance, expiry, and polling conflict rules in a separate plan.
- The UI needs a new admin role beyond current super-admin policy.

## Maintenance notes

Keep the registry as a typed operations client over stored state. New operator
actions require a plan 144 operation contract and plan 139 authorization entry
before UI controls are added.
