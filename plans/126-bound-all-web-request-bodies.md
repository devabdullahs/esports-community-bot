# Plan 126: Bound every web mutation request before parsing

> **Executor instructions**: Apply stream-level admission before JSON or
> multipart parsing. Do not rely on `Content-Length`, reverse-proxy limits, or a
> size check after `request.json()`/`request.formData()`. Run every gate and
> update the index row when done.
>
> **Drift check (run first)**: `git diff --stat 0718e2d..HEAD -- apps/web/src/lib/request-body.ts apps/web/src/app/api apps/web/src/test`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `0718e2d`, 2026-07-23

## Why this matters

The repository already documents that `request.json()` buffers an arbitrary
body before validation, but 36 mutation routes still use it directly and three
upload routes call `request.formData()` before checking the file size. An
authenticated community member or admin session can force large allocations in
the same Node process that hosts the Discord bot. This plan makes bounded body
admission a uniform route invariant without changing successful API shapes.

## Current state

- `apps/web/src/lib/request-body.ts:3-9` explains the threat and implements
  `readBoundedJson(request, maxBytes)` by reading/cancelling the stream.
- `apps/web/src/app/api/partners/inquiries/route.ts:26-35` is the JSON exemplar:
  it maps `too_large` to HTTP 413 and malformed JSON to 400.
- `apps/web/src/app/api/admin/graphics/asset/route.ts:41-54` calls
  `request.formData()` first and checks `file.size` afterward.
- `apps/web/src/test/request-body.test.ts` already covers exact limits,
  chunked overflow, dishonest `Content-Length`, and malformed JSON.
- Baseline discovery commands:

```powershell
rg -l "request\.json\(\)" apps/web/src/app/api --glob route.ts
rg -l "request\.formData\(\)" apps/web/src/app/api --glob route.ts
```

At planning time these return 36 JSON routes and these multipart routes:
`admin/graphics/asset`, `admin/graphics/brand`, and `admin/news/upload`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Body helper tests | `npm --workspace @esports-community-bot/web run test -- src/test/request-body.test.ts` | all pass |
| Route tests | `npm --workspace @esports-community-bot/web run test -- src/test/admin-authz.test.ts src/test/ewc-web-picks-api.test.ts` | all pass |
| Direct-parser audit | `rg -n "request\.(json|formData)\(\)" apps/web/src/app/api --glob route.ts` | no matches outside an explicitly documented exception |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Native typecheck | `npm --workspace @esports-community-bot/web run typecheck:native` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all tests pass |
| Web build | `npm run web:build` | exit 0 |

## Scope

**In scope**:

- `apps/web/src/lib/request-body.ts`
- `apps/web/src/test/request-body.test.ts`
- Every `apps/web/src/app/api/**/route.ts` returned by the two baseline
  discovery commands, including admin comments/games/media/news/partners/
  predictions/streams/team/users, member comments/picks/notifications/sync,
  and the two internal profile routes
- Focused existing route-test files when response assertions need 413 cases

**Out of scope**:

- GET/HEAD routes and response-size pagination.
- Changing field validation, authorization, CSRF, or rate-limit policy.
- Adding a multipart dependency when the native bounded-reparse approach works.
- Proxy/platform configuration as the only enforcement layer.

## Git workflow

- Branch: `codex/126-bounded-request-bodies`
- Commit style: `fix(web): bound mutation request bodies`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Generalize the bounded stream reader

Refactor `request-body.ts` around one private `readBoundedBytes` primitive that:

- treats `Content-Length` only as an early rejection;
- counts actual stream bytes and cancels immediately over the cap;
- returns `too_large` versus `invalid` without throwing raw parser errors;
- never consumes the body more than once.

Keep `readBoundedJson` behavior compatible. Add `readBoundedFormData` that
reads bounded bytes first, constructs a new `Request` with the original
`Content-Type`, and invokes native `formData()` only on that bounded buffer.
Do not manually parse multipart boundaries.

**Verify**: helper tests pass, including chunked multipart overflow before
`formData()` is invoked.

### Step 2: Define explicit route limits

Use route-local named constants. Defaults:

- tiny action/ID/status payloads: 8 KiB;
- normal structured settings/admin payloads: 64 KiB;
- bilingual news/editor payloads: 512 KiB;
- uploads: current accepted file cap plus at most 64 KiB multipart overhead.

If current validators permit legitimate content above these values, derive a
documented higher bound from those validators. Never use an unbounded or
multi-megabyte JSON default just to avoid choosing.

**Verify**: focused validator/route fixtures at their legitimate maximum remain
accepted; one byte beyond each representative cap returns 413.

### Step 3: Migrate every direct JSON parser

Replace each direct `request.json()` with `readBoundedJson`. Preserve existing
authorization ordering and successful response bodies. Standardize parsing
failures to 413 for `too_large` and 400 for invalid JSON; do not turn invalid
JSON into `{}` silently.

Internal-secret routes still need the cap even though callers are trusted. Do
not weaken their secret check or move body parsing before authentication.

**Verify**: the direct-parser audit reports only the three multipart routes.

### Step 4: Migrate the upload routes

Replace direct `request.formData()` in graphics asset, graphics brand, and news
upload routes with `readBoundedFormData`. Keep existing MIME, magic-byte, R2,
rate-limit, and audit behavior. Return 413 before allocating beyond the body
cap; retain the current user-facing file-size validation for a bounded but
oversized file.

**Verify**: the direct-parser audit reports zero matches.

### Step 5: Add route-level regression coverage and run all gates

Add representative tests for an anonymous/member JSON route, an admin editor
route, an internal route, and one upload route. Assert auth still runs before
body parsing where applicable, invalid JSON is 400, and overflow is 413.
Run the full command table and inspect scope.

## Test plan

- Extend `request-body.test.ts` for empty bodies, UTF-8 byte length, multiple
  chunks, false `Content-Length`, multipart success, malformed multipart, and
  multipart overflow.
- Route tests cover all three limit classes and at least one upload.
- No test allocates a genuinely huge buffer; cross the configured test cap with
  small synthetic chunks.

## Done criteria

- [ ] No API route calls `request.json()` or `request.formData()` directly.
- [ ] Every mutation has a named, justified byte cap.
- [ ] Actual streamed bytes, not just `Content-Length`, enforce the cap.
- [ ] Overflow consistently returns 413 and malformed bodies return 400.
- [ ] Existing auth, CSRF, validation, audit, and response contracts remain.
- [ ] All web gates pass.

## STOP conditions

- A route legitimately needs a streaming upload larger than the existing R2
  file cap; report it rather than buffering a larger body.
- Reconstructing a bounded native `Request` loses multipart headers in the
  installed Node runtime.
- A route consumes the request body before the helper can enforce admission.
- Migration requires changing a public successful response contract.

## Maintenance notes

Add a review rule: any new body-consuming route must use a bounded helper. A
reverse-proxy cap remains useful defense in depth but is not a substitute for
this application invariant.
