# Plan 137: Close the bot-to-web capability boundary

> **Executor instructions**: Replace raw-path internal HTTP calls with named
> operations, route-specific credentials, exact-origin URL construction, and
> redirect refusal. Preserve the current combined bot+web deployment and do not
> create a general internal proxy.
>
> **Drift check (run first)**:
> `git diff --stat d1b66e1..HEAD -- src/config.js src/commands/ewc_predict.js src/jobs/ewcPredictions.js src/jobs/scheduledNewsPublisher.js apps/web/src/lib/env.ts apps/web/src/lib/internal-auth.ts apps/web/src/app/api/internal apps/web/src/test tests .env.example README.md docs`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: 126 (same route bodies; rebase instead if 126 is still open)
- **Category**: security
- **Planned at**: commit `d1b66e1`, 2026-07-24

## Why this matters

The reviewed incident began when user-controlled data crossed into an internal
URL path. The external service then acted as a privileged proxy, and one
compromised trust boundary exposed unrelated internal capabilities.

This repository does not currently pass user input into an internal path.
However, its bot helper accepts an arbitrary `path`, every internal endpoint
shares one bearer-equivalent secret, and server-side `fetch` follows redirects
unless told otherwise. These are latent versions of the same failure class:
one future call-site mistake, redirect, or leaked credential could widen from
one operation to all three current internal routes.

OWASP recommends allowlisting identified service destinations and disabling
redirect following for server-side requests. NIST SP 800-207 also rejects
implicit trust based only on network location.

## Current state

- `src/commands/ewc_predict.js:164-178` defines
  `dashboardInternalRequest(path, body)` and concatenates `path` onto the
  configured base URL.
- Its current callers pass only constant sync/unlink paths
  (`src/commands/ewc_predict.js:185,1267,1278`); no present path-injection
  exploit was found.
- `src/jobs/ewcPredictions.js:483-498` and
  `src/jobs/scheduledNewsPublisher.js:10-20` duplicate fixed internal requests.
- None of these requests consistently sets `redirect: "error"`; the command
  helper also lacks a timeout.
- `apps/web/src/lib/internal-auth.ts:5-12` compares one
  `EWC_DASHBOARD_INTERNAL_SECRET` for every internal route.
- That credential authorizes profile sync, profile unlink, and news cache
  revalidation. The unlink route accepts any format-valid Discord ID after
  service authentication.
- The sync route correctly resolves the configured guild server-side and
  rejects a different caller-supplied guild
  (`apps/web/src/app/api/internal/ewc-profile/sync/route.ts:37-45`).
- Production documentation places both processes in one service and sets the
  internal URL to loopback. This narrow topology should become an enforced
  invariant, not only a convention.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Bot internal-client tests | `node --test tests/dashboardInternalClient.test.mjs tests/ewcProfileAutoSync.test.mjs` | all pass; local fake server only |
| Web internal-auth tests | `npm --workspace @esports-community-bot/web run test -- src/test/internal-auth.test.ts src/test/ewc-profile-internal.test.ts` | all pass |
| Raw-path audit | `rg -n "dashboardInternalRequest|/api/internal|x-ewc-internal-secret" src --glob "*.js"` | only the closed client owns routes/auth |
| Legacy-secret audit | `rg -n "EWC_DASHBOARD_INTERNAL_SECRET|internalSecret\\(" src apps/web/src .env.example README.md docs` | no runtime use or undocumented fallback |
| Bot suite | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Native typecheck | `npm --workspace @esports-community-bot/web run typecheck:native` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

## Scope

**In scope**:

- One bot-side internal client module with named sync and revalidate functions.
- Removal of the service-authorized unlink endpoint; unlink remains available
  through the existing session-bound web self-service route.
- Exact internal-base validation for the current same-container topology.
- Route-specific credentials and constant-time comparison.
- Redirect refusal, request timeouts, bounded response handling, and sanitized
  errors.
- Exact request schemas, service-operation logging, tests, and canonical env/
  deployment documentation.

**Out of scope**:

- A generic HTTP proxy, service discovery, multi-guild/multi-tenant design, or
  arbitrary internal host allowlists.
- Moving Better Auth/Discord OAuth logic into the bot process.
- Treating Cloudflare, loopback, or a private network as authorization.
- Containing full code execution in the combined bot+web container. That level
  of compromise can read all process credentials and the shared database; this
  plan contains confused-deputy mistakes and individual credential leakage.
- mTLS/service-mesh work. If bot and web become separate deployable services,
  stop and design that topology independently.

## Git workflow

- Branch: `codex/137-close-bot-web-boundary`
- Commit style: `fix(security): close bot-to-web capabilities`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Specify a closed internal-client API

Create one bot-side module, for example
`src/services/dashboardInternalClient.js`, exporting only:

- `syncDashboardProfile({ discordUserId, guildId, season })`;
- `revalidateDashboardNews()`.

Keep the route table private and immutable. Do not export a function that
accepts a URL, pathname, method, header map, or operation name supplied by a
caller. Migrate all command/job call sites to these two functions and delete
the duplicated request construction.

Add a source-level regression assertion that no caller outside this module
contains `/api/internal/` or the internal authorization header.

The `/ewc_predict unlink` command must stop performing a service-authorized
mutation. Keep the command as a no-side-effect UX that links the member to the
authenticated dashboard unlink control. The existing `/api/me/ewc/unlink`
handler remains the decision point because it derives the Discord account from
the Better Auth session instead of accepting a caller-selected subject.

**Verify**: an attempted test call with a raw `../`, encoded separator,
absolute URL, or unknown operation is impossible through the exported API.

### Step 2: Parse and pin the internal origin before attaching credentials

Parse `EWC_DASHBOARD_INTERNAL_URL` once. For the current combined deployment:

- accept only `http:` loopback hosts (`127.0.0.1`, `[::1]`, or `localhost`);
- require an explicit valid port, root pathname, and no username, password,
  query, or fragment;
- construct each target from the private constant pathname;
- assert the final origin is identical to the validated base origin before
  adding a credential header.

Production startup must fail with a sanitized configuration error if internal
features are enabled but the URL violates this contract. Development may use
the same loopback forms. Do not silently fall back to the public dashboard URL.

Every request must use `redirect: "error"` and a bounded timeout. Read at most
the small documented response limit before JSON parsing; do not log or surface
an upstream body verbatim.

**Verify**: fake-server tests cover loopback success, public/private non-loopback
rejection, credentials/query/fragment rejection, redirect refusal, timeout,
oversized response, invalid JSON, and non-secret error text.

### Step 3: Split authorization by capability

Replace the shared secret with independent credentials:

- `EWC_DASHBOARD_INTERNAL_PROFILE_SYNC_SECRET`;
- `EWC_DASHBOARD_INTERNAL_NEWS_REVALIDATE_SECRET`.

Change `isInternalRequestAuthorized` to require an explicit capability and
select only that capability's expected credential. Keep constant-time
comparison and fail closed for missing/placeholder/short production values.
The sync credential must not authorize revalidation and vice versa.

Bot and web ship in the same image, so cut over atomically. Do not retain a
permanent `EWC_DASHBOARD_INTERNAL_SECRET` fallback. If one deployment needs a
short migration window, make dual-read explicit, time-bounded, tested, and
removed before marking the plan done.

Update `.env.example`, README, CranL/NAS docs, and compose comments together.
Never print credential values, prefixes, or lengths.

**Verify**: a complete 2x2 capability/route test matrix permits only the
matching credential; empty, legacy, malformed, and wrong credentials return
the same 401 shape.

### Step 4: Keep authorization and subject rules inside each route

Authenticate before parsing the body. After plan 126, use bounded JSON parsing.
Reject unknown fields as well as malformed values.

Preserve server-derived guild pinning for profile sync. Delete
`/api/internal/ewc-profile/unlink` and prove it is absent from the built route
inventory. Keep profile unlink only on `/api/me/ewc/unlink`, where the stored
Discord account is derived from the authenticated session; do not accept a
Discord/auth user ID in that request's path, query, or body.

Sync and revalidation must log a structured security event containing
operation, caller capability, result, and a request correlation ID—never the
credential, Discord OAuth token, or raw upstream response.

Do not add a route that accepts a downstream URL, service name, resource path,
or redirect target. Return stable generic client errors while retaining
diagnostic details only in server logs.

**Verify**: unauthorized requests are rejected before body reads; extra fields,
alternate guilds, and cross-capability credentials fail closed.

### Step 5: Run all gates and review the final blast radius

Run every command in the table. Review the result as if each one of the two
credentials leaked independently and document the only operation it permits.
Confirm the public API catalog and human documentation still contain no
internal route names or credential header examples.

Document the residual boundary honestly: splitting capabilities contains a
single leaked credential or confused-deputy call. It does not contain full bot
process/container compromise because that process can read both credentials
and the shared database.

## Test plan

- Pure URL/base validation tests, including dot segments, encoded separators,
  backslashes, credentials, query/fragment, and absolute target attempts.
- Local fake HTTP server tests for redirect, timeout, response cap, and
  sanitized errors; no external network.
- 2x2 capability/route authorization matrix.
- Existing sync, session-bound web unlink, guild pinning, rate limits, and
  scheduled revalidation remain covered.

## Done criteria

- [ ] Bot callers cannot supply an internal path, URL, method, or headers.
- [ ] No internal/service credential can unlink an arbitrary profile; unlink
      derives the member from an authenticated web session.
- [ ] Internal credentials are attached only after exact loopback-origin
      validation.
- [ ] Internal requests refuse redirects and have time/response bounds.
- [ ] Each route accepts only its own capability credential.
- [ ] The legacy shared secret has no runtime fallback.
- [ ] Guild and object checks remain application-side.
- [ ] Logs and client errors expose no credentials, OAuth tokens, response
      bodies, or internal topology.
- [ ] All repository gates pass.

## STOP conditions

- Production bot and web no longer run in the same service/loopback network.
- A caller genuinely needs arbitrary internal URLs or dynamic route discovery.
- Credential rotation cannot be atomic and no explicit short migration window
  is approved.
- Plan 126 changes the internal route body contract; rebase and preserve its
  bounded parser rather than reintroducing `request.json()`.

## Maintenance notes

Any new bot-to-web operation must add one named client method, one private
constant route, one dedicated capability, a negative cross-capability matrix,
and documentation. A network/edge block is defense in depth only; the route
must still authenticate and authorize the operation.

## Standards references

- OWASP SSRF Prevention Cheat Sheet:
  <https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html>
- NIST SP 800-207, Zero Trust Architecture:
  <https://csrc.nist.gov/pubs/sp/800/207/final>
