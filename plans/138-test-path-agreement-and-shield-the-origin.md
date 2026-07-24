# Plan 138: Test path agreement and shield the application origin

> **Executor instructions**: Add a non-destructive production-server regression
> corpus for path confusion and prove that the deployed origin cannot bypass
> the trusted ingress. Edge rules are defense in depth; protected handlers must
> still fail closed without them.
>
> **Drift check (run first)**:
> `git diff --stat d1b66e1..HEAD -- apps/web/src/proxy.ts apps/web/next.config.ts apps/web/src/app/.well-known apps/web/src/app/api/internal apps/web/src/test scripts package.json compose.ugreen.yml README.md docs .github`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: 137 recommended
- **Category**: security
- **Planned at**: commit `d1b66e1`, 2026-07-24

## Why this matters

The reviewed incident used different path interpretations at the WAF and
backend. A request appeared harmless to the edge ACL but normalized to a
protected backend path. The same chain becomes worse when the public origin is
reachable directly or when proxy-authored identity headers are trusted from
untrusted peers.

This repository does not use Cloudflare as its admin/internal authorization
mechanism, which is good. It does, however, trust `cf-connecting-ip` when
`EWC_TRUSTED_PROXY=cloudflare`, and the self-hosted compose example publishes
port 3000 while also using a tunnel. The active CranL origin restriction is an
external deployment fact not proven by repository tests. A repeatable boundary
probe and an explicit origin-shield invariant close that evidence gap.

## Current state

- Next's locale proxy excludes `/api` from its matcher
  (`apps/web/src/proxy.ts`), so API authorization occurs in route handlers.
- Internal routes reject a missing/wrong secret with 401; admin/member routes
  have application-side session/role checks.
- `apps/web/src/lib/community.ts:189-194` trusts `cf-connecting-ip` only in the
  explicit Cloudflare mode, but it cannot verify the TCP peer from a Fetch
  `Request`.
- `compose.ugreen.yml:46-47` publishes `${EWC_DASHBOARD_PORT:-3000}:3000`,
  although its comment says the port may be removed when the tunnel is used.
- The active production target is CranL behind Cloudflare; whether the origin
  has an alternate public hostname/port must be verified outside the source
  tree.
- `apps/web/next.config.ts:36` advertises a public API catalog. The catalog
  currently lists only public tournament, leaderboard, MCP, and feed surfaces
  and does not disclose internal routes.
- No Swagger/OpenAPI route or internal documentation endpoint was found.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Local boundary corpus | `npm run security:boundary` | all raw-path probes fail closed; no destructive calls |
| Catalog test | `npm --workspace @esports-community-bot/web run test -- src/test/api-catalog-security.test.ts` | private/internal inventory absent |
| Proxy tests | `npm --workspace @esports-community-bot/web run test -- src/test/proxy-locale.test.ts src/test/client-ip.test.ts` | all pass |
| Compose render | `docker compose -f compose.ugreen.yml config` | no unintended public origin bind in tunnel profile |
| Bot suite | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Native typecheck | `npm --workspace @esports-community-bot/web run typecheck:native` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

## Scope

**In scope**:

- A raw HTTP path-confusion regression runner against a production Next server.
- A read-only staging/public-vs-origin probe mode.
- Origin shielding for the documented Cloudflare/CranL and tunnel deployments.
- Trusted-proxy configuration checks, private API inventory tests, and
  operational evidence/runbooks.

**Out of scope**:

- Vendor-specific exploit development or active WAF bypass attempts.
- Sending valid credentials, invoking destructive operations, or probing
  systems outside this application.
- Replacing route-level authorization with Cloudflare rules.
- General penetration testing of CranL, Cloudflare, Discord, or third parties.

## Git workflow

- Branch: `codex/138-path-agreement-origin-shield`
- Commit style: `test(security): enforce path and origin boundaries`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Define a harmless normalization corpus

Add a versioned fixture of request-target variants around protected API
prefixes. Include, where the Node HTTP parser permits them:

- single/double encoded dot segments and separators;
- duplicate slashes, backslashes, mixed slash forms, and trailing dots;
- semicolon/matrix-style suffixes and path parameters;
- percent-encoding case variants, double encoding, and encoded control bytes;
- locale prefixes before protected paths;
- absolute-form request targets and conflicting Host values.

Use only unauthenticated requests or deliberately invalid capability values.
Targets must be selected so success has no side effect. Do not include a valid
session cookie, internal credential, MCP key, or state-changing body.

For every fixture, record one exact expected backend classification—not a loose
set of acceptable error codes. At minimum store:

- the raw request target and method;
- the intended route class (`unmatched`, `public`, `admin`, `member`,
  `admin-mcp`, or a specific internal capability);
- the exact expected local status/redirect class and a stable response
  fingerprint (selected safe headers plus a body-shape identifier);
- the expected public-edge and direct-origin classifications.

The suite must fail if a variant changes route class even when both old and new
statuses are non-2xx. For example, `404 unmatched` becoming `401 internal-sync`
is a path-normalization regression, not an acceptable denial. Any 2xx from an
admin, member, MCP-admin, or internal handler is also a failure.

### Step 2: Exercise the real production router

Create `scripts/security/probe-boundaries.mjs` (or equivalent) that starts the
built Next application on a disposable loopback port with a disposable test
database, then sends raw request targets using `node:http`/`node:net` rather
than `fetch`, which may normalize before transmission.

Record status, normalized Location (if any), safe distinguishing headers, and a
body-shape classification—not full bodies or secrets. Assert that:

- edge/backend-style path variants cannot turn an unauthenticated request into
  a successful protected operation;
- internal endpoints never redirect;
- locale rewrites do not enter `/api`, `/admin`, or `/me` unexpectedly;
- private responses are not marked publicly cacheable;
- unknown internal paths remain 404 and known ones remain authenticated.

Wire this as `npm run security:boundary`. Keep the local runner deterministic
and network-isolated.

### Step 3: Add a safe deployed-boundary mode

Support explicit `--public-base` and `--origin-base` inputs for authorized
staging/production verification. This mode must use the same harmless corpus,
never auto-discover hosts, never send credentials, and default to dry/read-only
behavior.

Compare each deployed result with the fixture's explicit public-edge and origin
expectations. An edge may intentionally block before the application, but that
expected difference must be recorded per case. Unexpected transitions between
unmatched, public, admin, member, MCP, and internal route fingerprints fail even
when both statuses are denials. Emit a machine-readable JSON report with
timestamp, deployment version, bases redacted to origins, and per-case result.
Document operator approval and rate limits before running it against production.

### Step 4: Enforce and document origin shielding

For the tunnel compose path, remove the default public host-port publication or
bind it to loopback only. If optional LAN access remains supported, place it in
an explicit opt-in compose profile and document that
`EWC_TRUSTED_PROXY=cloudflare` is unsafe on an untrusted direct listener.

For CranL, record and verify the actual controls that prevent direct origin
access: provider ingress policy, private service binding, allowed proxy
sources, and alternate platform hostname behavior. Do not claim shielding from
DNS alone. Add a deploy checklist that requires the public-vs-origin boundary
report before enabling trusted proxy mode.

A Cloudflare rule may block `/api/internal/*` as extra containment because the
bot uses loopback, but document it as non-authoritative. The application must
still return 401/404 if that rule is disabled or bypassed.

### Step 5: Guard API inventory and error behavior

Add tests that the public API catalog:

- contains only an explicit public allowlist;
- never contains `/api/internal`, `/api/admin`, `/api/me`, admin MCP, secret
  header names, private hostnames, or environment-derived internal origins;
- does not grow automatically by scanning route files.

Inventory every publicly served API-description surface, not only the catalog:
route-based docs, OpenAPI/Swagger-like paths, well-known discovery links,
static artifacts under `public`, and generated build output. Keep an explicit
allowlist for intentionally public documentation such as public MCP and, if the
product keeps it public, admin MCP setup documentation. Even allowlisted docs
must never disclose `/api/internal` routes, service credential header names,
credential values/examples, private origins, or an automatically generated
private route inventory. Probe the built production server for common
description paths and fail if a new surface appears without classification.

Retain `security.txt`. Ensure protected error responses use stable generic
messages/correlation IDs and do not expose stack traces, internal origins,
redirect targets, or upstream bodies.

### Step 6: Add CI and operational ownership

Run the local boundary corpus after the production web build in CI. Keep the
deployed probe manual or scheduled only after an operator supplies approved
bases; it must never infer an origin from public DNS.

Document who owns CranL/Cloudflare evidence, how often it is rechecked, and
which deployment changes require rerunning it: ingress changes, proxy-mode
changes, new internal routes, framework upgrades, or URL-rewrite changes.

## Test plan

- Raw request-target corpus against the built production server.
- Locale proxy and trusted-client-IP unit regressions.
- Public API catalog denylist/allowlist test.
- Compose configuration check.
- Authorized staging comparison of public ingress and origin, saved as a
  redacted report.

## Done criteria

- [ ] A versioned path-confusion corpus exercises the real production router.
- [ ] Every fixture pins a backend route classification/fingerprint; one denied
      route class changing into another is a failure.
- [ ] No corpus case reaches a protected handler successfully without its own
      application authorization.
- [ ] Internal endpoints never redirect and remain 401/404 without credentials.
- [ ] The active production origin is demonstrably shielded from untrusted
      direct traffic.
- [ ] Trusted proxy mode is enabled only with that shield.
- [ ] Every public API-description surface is classified and none discloses
      internal routes, service credentials, or private origins.
- [ ] The local boundary gate runs in CI and all repository gates pass.

## STOP conditions

- No authorized way exists to identify or test the CranL origin. Complete the
  local/code work, mark deployed-origin proof blocked, and request operator
  evidence; do not scan for it.
- A corpus case could cause a state change or requires a valid credential.
- Cloudflare/CranL requires a public origin for health checks with no source
  restriction. Escalate the architecture tradeoff instead of declaring it
  shielded.
- A framework/proxy normalizes a raw target before the harness can observe it;
  preserve the case and document the layer rather than weakening the expected
  result.

## Maintenance notes

Add new path variants after proxy/framework incidents, but keep the corpus
non-destructive. Any new internal route or rewrite must update the inventory
test and rerun public-vs-origin comparison. Edge blocking may reduce noise; it
never replaces endpoint authentication, object authorization, or rate limits.

## Standards references

- NIST SP 800-207, Zero Trust Architecture:
  <https://csrc.nist.gov/pubs/sp/800/207/final>
- OWASP API Security Top 10 (API7 SSRF, API8 misconfiguration, API9 inventory):
  <https://owasp.org/API-Security/editions/2023/en/0x11-t10/>
