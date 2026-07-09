# Plan 072: Make MCP writes atomic, audited, and idempotent

> **Executor instructions**: This is a dual-database change. Follow each step,
> run every verification, and stop rather than approximating transaction
> behavior. Update the plan row in `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 5091ff1..HEAD -- src/db/client.js src/db/ewcNewsPosts.js src/db/ewcAdminAuditLog.js src/db/streamChannels.js src/db/index.js scripts/postgres/schema.sql scripts/migrate-sqlite-to-postgres.mjs apps/web/src/lib/mcp-tools.ts apps/web/src/lib/news.ts apps/web/src/lib/stream-channels.ts apps/web/src/test/mcp-api.test.ts`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plan 070
- **Category**: security
- **Planned at**: commit `5091ff1`, 2026-07-09

## Why this matters

An MCP draft or stream update is currently committed before its audit entry. A
logging failure can therefore return an error after the mutation succeeded,
and a client retry can create a duplicate draft. Stream updates also perform
the primary row, sibling propagation, and default clearing as separate
autocommit statements. The complete write, audit record, and retry receipt must
commit or roll back together on both better-sqlite3 and Postgres.

## Current state

- `apps/web/src/lib/mcp-tools.ts:340-357` creates a draft, then awaits audit.
- `apps/web/src/lib/mcp-tools.ts:384-389` updates a stream, then awaits audit.
- `src/db/streamChannels.js:361-411` performs up to three independent updates.
- `src/db/ewcNewsPosts.js:307-345` already uses `transaction`, so wrapping the
  public function in another transaction would create an invalid nested
  transaction.
- `src/db/client.js:153-180` supplies one transaction-bound client for both
  backends. This is the primitive to reuse.
- `src/db/ewcAdminAuditLog.js:27-33` always writes through the global client.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Receipt tests | `node --test tests/mcpWriteReceipts.test.mjs tests/migrationScriptTables.test.mjs` | all pass |
| Focused MCP tests | `npm --workspace @esports-community-bot/web run test -- src/test/mcp-api.test.ts` | all pass |
| Bot tests | `npm test` | exit 0 |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

## Scope

**In scope**:

- `src/db/index.js`
- `scripts/postgres/schema.sql`
- `scripts/migrate-sqlite-to-postgres.mjs`
- `src/db/mcpWriteReceipts.js` (new)
- `src/db/ewcNewsPosts.js`
- `src/db/ewcAdminAuditLog.js`
- `src/db/streamChannels.js`
- `apps/web/src/lib/mcp-write.ts` (new)
- `apps/web/src/lib/news.ts`
- `apps/web/src/lib/stream-channels.ts`
- `apps/web/src/lib/mcp-tools.ts`
- `apps/web/src/lib/admin-mcp-copy-page.ts`
- `docs/ADMIN_MCP.md`
- `tests/mcpWriteReceipts.test.mjs` (new)
- `tests/migrationScriptTables.test.mjs`
- `tests/streamChannels.test.mjs` (or the existing stream DB test file)
- `apps/web/src/test/mcp-api.test.ts`

**Out of scope**:

- General idempotency for dashboard HTTP routes.
- Publishing through MCP.
- Changing the audit log's public viewer or retention policy.
- Refactoring unrelated DB modules to accept transaction clients.

## Git workflow

- Branch: `codex/072-atomic-idempotent-mcp-writes`
- Prefer two commits: DB transaction primitives/tests, then MCP integration.
- Example messages: `Add MCP write receipts` and `Make MCP writes atomic`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add the dual-backend idempotency receipt table

Add `ewc_mcp_write_receipts` to SQLite and Postgres schemas with:

- `key_id` (integer/bigint)
- `tool_name` text
- `idempotency_key` text
- `result_json` nullable text while claimed, non-null when complete
- `created_at` and `completed_at`
- primary/unique key on `(key_id, tool_name, idempotency_key)`

Do not store bearer secrets or request bodies. Add the table to the migration
script's copied table list and its integer-ID handling only if required by that
script's current structure. Extend `migrationScriptTables.test.mjs` so schema
and migration lists cannot drift.

**Verify**: receipt + migration tests pass.

### Step 2: Implement transaction-bound receipt operations

Create `src/db/mcpWriteReceipts.js` with functions that all accept an explicit
transaction client:

- `claimMcpWriteReceipt(tx, { keyId, toolName, idempotencyKey })`
- `completeMcpWriteReceipt(tx, ..., result)`
- `getMcpWriteReceipt(tx, ...)`

The claim must use `INSERT ... ON CONFLICT DO NOTHING RETURNING` with distinct
`$n` placeholders. Under Postgres, a concurrent conflict waits for the first
transaction; under SQLite, `BEGIN IMMEDIATE` serializes writers. A caller that
did not claim reads and replays the completed receipt. Validate the
idempotency key as an opaque 8-100 character string and never log it as a
credential (it is not secret, but it should stay bounded).

Add tests for first claim, completion, replay, same key on different tools,
same idempotency string on different MCP keys, malformed JSON fail-closed, and
rollback leaving no claimed row.

**Verify**: `node --test tests/mcpWriteReceipts.test.mjs` -> all pass.

### Step 3: Make existing DB writes composable inside one transaction

Refactor without changing default callers:

- Extract the body of `createEwcNewsPost` into an exported transaction-bound
  helper that accepts `tx` and returns the inserted ID. The existing public
  function still opens one transaction and hydrates after commit.
- Allow `recordAdminAudit` to accept an optional explicit client; default to
  the global `run` path for existing dashboard calls.
- Refactor `updateStreamChannel`, `allowedSiblingIds`, and row reads used by the
  update to use one supplied client. The existing wrapper still opens no new
  transaction when called normally; add an explicit transaction-bound helper
  for MCP.

Do not call `transaction()` from inside another transaction. Do not hydrate a
new news post through the global Postgres pool before the outer transaction
commits; return the ID and hydrate after commit.

Add a stream DB fault-injection test: throw after the primary update but before
sibling/default updates and assert every affected row retains its original
state after rollback.

**Verify**: `npm test` -> all bot tests pass.

### Step 4: Add a web orchestration helper

Create `apps/web/src/lib/mcp-write.ts` with a server-only helper such as
`runIdempotentMcpWrite`. It must:

1. open `transaction` from `@bot/db/client.js`;
2. claim `(access.key.id, toolName, idempotencyKey)`;
3. if already complete, return its stored stable result with `replayed: true`;
4. run the mutation callback with the same `tx`;
5. write the audit entry with the same `tx`;
6. complete the receipt with a small stable result (`postId` or `channelId`);
7. commit, then hydrate the public result through the normal wrapper.

An exception in steps 4-6 must roll back mutation, audit, and receipt. Do not
catch and convert the error until after `transaction` has rolled back.

**Verify**: web lint and build pass.

### Step 5: Require idempotency keys on both MCP write tools

Add a required `idempotencyKey` Zod input to `create_news_draft` and
`update_stream_channel`, described as a caller-generated UUID or unique opaque
token reused only when retrying the same operation. Wire both handlers through
the helper.

For stream updates, re-read and re-authorize the channel inside the transaction
before mutation. Keep scope propagation restrictions unchanged. Return the
normal object plus `replayed: boolean`.

Update admin MCP copy/docs examples to include an idempotency key for writes.

**Verify**: focused MCP tests pass.

### Step 6: Prove rollback and replay behavior at the MCP boundary

Add tests that:

- two identical draft calls with one idempotency key create one post and one
  audit row, with the second result marked replayed;
- the same payload with different idempotency keys creates two drafts;
- an injected audit failure leaves no post, stream mutation, or receipt;
- an injected sibling-update failure leaves every stream row unchanged and no
  audit/receipt;
- a retry after a simulated response loss returns the original identifiers;
- a key cannot replay another key's receipt.

Use dependency injection or a narrowly scoped test hook; do not add production
environment flags that deliberately break writes.

**Verify**: focused MCP tests pass with deterministic row counts.

## Test plan

- DB receipt lifecycle: claim, complete, replay, per-key/per-tool uniqueness,
  malformed result handling, and rollback.
- Stream update transaction: primary row, sibling propagation, and default
  clearing succeed together; injected failure rolls all of them back.
- Draft MCP retry with one idempotency key creates one post and one audit row.
- Different idempotency keys remain distinct operations.
- Audit failure and mutation failure leave no receipt or partial domain write.
- Migration parity test confirms both schemas and the migration table list.
- Run the full bot and web suites after focused fault-injection tests.

## Done criteria

- [ ] Each MCP write, audit row, and receipt is one transaction.
- [ ] Stream primary/sibling/default changes are atomic.
- [ ] Retrying one idempotency key cannot duplicate a draft.
- [ ] Receipt rows contain no bearer key or full request body.
- [ ] SQLite and Postgres schemas/migration lists stay in sync.
- [ ] No nested transaction is introduced.
- [ ] All required repo checks pass.
- [ ] Plan 072 is marked DONE.

## STOP conditions

- The transaction client cannot be threaded through the DB helpers without a
  public return-type break for existing callers.
- `ON CONFLICT DO NOTHING RETURNING` is not supported by either configured DB
  version.
- A nested transaction appears anywhere in the proposed MCP path.
- Postgres behavior cannot be tested or reasoned about with the current client
  abstraction; report the exact missing primitive.
- Any step requires storing the MCP bearer secret.

## Maintenance notes

Receipts are operational records; add bounded retention later if volume becomes
meaningful, but never delete a recent receipt while clients may retry. Reviewers
should focus on transaction-client use, concurrent claim behavior, and absence
of secrets in `result_json`.
