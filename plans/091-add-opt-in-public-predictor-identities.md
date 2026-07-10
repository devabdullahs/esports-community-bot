# Plan 091: Add opt-in public predictor identities

> **Executor instructions**: Privacy defaults must remain anonymous. Derive the
> public name/avatar from the authenticated account server-side; never accept a
> Discord ID or display identity supplied by the browser. Raw Discord IDs must
> remain absent from public leaderboard and MCP responses.
>
> **Drift check (run first)**: `git diff --stat 2301227..HEAD -- src/db/ewcProfileLinks.js src/db/index.js scripts/postgres/schema.sql src/lib/ewcProfileStats.js apps/web/src/app/api/me/ewc apps/web/src/components/dashboard/profile-dashboard.tsx apps/web/src/components/dashboard/leaderboard-table.tsx apps/web/src/lib/public-ewc-leaderboard.ts apps/web/src/lib/i18n.ts apps/web/src/app/privacy/page.tsx tests/ewcProfileStats.test.mjs apps/web/src/test/ewc-leaderboard.test.ts`

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED
- **Depends on**: plan 086
- **Category**: direction
- **Planned at**: commit `2301227`, 2026-07-10

## Why this matters

The public prediction board intentionally stopped returning raw Discord IDs,
but every row now appears as `Member ####`. That protects privacy while making
the community competition difficult to recognize, and four-digit suffixes can
collide. Linked members should be able to opt into publishing a bounded display
name/avatar, with anonymity as the default and immediate revocation. The public
shape must remain safe for the website and public MCP.

## Current state

- `src/lib/ewcProfileStats.js:59-60` derives `Member <last four digits>`.
- `src/lib/ewcProfileStats.js:283-309` uses that label for every public row and
  deliberately omits `userId`.
- `apps/web/src/components/dashboard/leaderboard-table.tsx:77-83` renders only
  `displayName` and has no identity/avatar contract.
- Commit `19f0b98` removed public Discord snowflakes; preserve that security
  boundary.
- `ewc_profile_links` already associates authenticated and Discord users and is
  the appropriate shared place for a consented public snapshot.
- Better Auth session name/image are available server-side in
  `apps/web/src/app/api/me/ewc/route.ts:33-35`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused bot tests | `node --test tests/ewcProfileStats.test.mjs tests/ewcPublicIdentity.test.mjs` | all pass |
| Focused web tests | `npm --workspace @esports-community-bot/web run test -- src/test/ewc-public-identity.test.ts src/test/ewc-leaderboard.test.ts src/test/ewc-sync.test.ts` | all pass |
| Bot suite | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Native typecheck | `npm --workspace @esports-community-bot/web run typecheck:native` | exit 0 |
| Web build | `npm run web:build` | exit 0 |

## Suggested executor toolkit

- Invoke the `shadcn` skill. Use existing Switch, Avatar, AlertDialog, Field,
  and Badge primitives for explicit consent and preview.

## Scope

**In scope**:

- `src/db/ewcProfileLinks.js`
- `src/db/index.js` and `scripts/postgres/schema.sql`
- `src/lib/ewcProfileStats.js`
- A new same-origin member route under `/api/me/ewc/public-identity`
- Profile Settings UI and leaderboard avatar/name rendering
- Public leaderboard cache invalidation
- Privacy-page and bilingual copy updates
- Focused bot/web tests

**Out of scope**:

- Returning raw Discord IDs, usernames/discriminators, email, or account IDs.
- Making identity public by default or inferring consent from profile linking.
- Admin-controlled identity overrides.
- Public profile pages or social messaging.
- Changing ranks/scores; consume plan 086 unchanged.

## Git workflow

- Branch: `advisor/091-opt-in-predictor-identities`
- Suggested commit: `feat: add opt-in leaderboard identities`
- Do not push or open a PR unless requested.

## Steps

### Step 1: Add consented identity snapshot fields

Add dual-backend fields to `ewc_profile_links`:

- `public_identity_enabled` default false;
- bounded `public_display_name` and `public_avatar_url`;
- `public_identity_updated_at`.

Hydrate safe camelCase fields in the DB helper. Existing rows remain disabled.
Do not store email, username history, OAuth tokens, or raw profile JSON.

**Verify**: fresh/migrated SQLite and Postgres schemas default existing/new
links to anonymous.

### Step 2: Add an authenticated consent route

Create a POST/DELETE or PATCH route that uses `sameOriginOr403`,
`requireVerifiedMember`, and a per-member rate limit. On enable, derive name and
avatar exclusively from the current Better Auth session/account; normalize and
bound the name, and accept avatar only from existing approved HTTPS/CDN policy.
On disable, clear the public snapshot immediately rather than leaving dormant
PII.

Ignore/reject browser-supplied display names, avatars, Discord IDs, guilds, and
seasons. Invalidate leaderboard/public MCP cache tags after change.

**Verify**: authorization/CSRF/block/rate tests, spoof attempts, enable/refresh,
disable, and absent-avatar cases pass.

### Step 3: Batch-project identity without leaking IDs

In `getPublicEwcLeaderboard`, batch-load consented snapshots for the page's
internal user IDs. Return only `displayName` and optional `avatarUrl`; never
return the lookup key. Disabled/missing records use the existing anonymous
label. Resolve duplicate visible names with a presentation-safe marker that
does not expose or encode the Discord ID.

Do not issue one query per row. Public MCP must consume the same safe projection.

**Verify**: tests inspect serialized JSON recursively for Discord IDs/auth IDs,
and query-count tests prove one bounded identity lookup per page.

### Step 4: Add an explicit profile setting and preview

In `/me?tab=settings`, add a default-off switch with plain copy explaining that
the current display name/avatar will appear on the public prediction
leaderboard and public MCP clients. Show exact preview and a confirmation dialog
when enabling. Disabling should be one clear action and update the preview/list
without hard refresh.

Use logical RTL layout and do not imply that linked-role/profile functionality
requires public identity.

**Verify**: English/Arabic mobile/desktop acceptance, disabled default,
enable/refresh/disable, and error rollback.

### Step 5: Render public identity accessibly

Extend leaderboard row type/UI with optional avatar. Use stable avatar/fallback
dimensions and keep names wrapping/truncating professionally. Search/sort uses
the public display name. Anonymous rows remain understandable.

Update privacy disclosure to explain purpose, fields, opt-in, revocation, and
that predictions/scores remain public under anonymous labels when disabled.

**Verify**: page/API/public MCP fixtures agree and no layout overflow occurs.

### Step 6: Run all gates and privacy review

Run every command. Search public payloads, HTML/RSC output, logs, and MCP tool
responses for seeded raw Discord/auth IDs. Confirm disabling removes identity
after cache invalidation and does not delete prediction history.

## Test plan

- Dual-backend migration/default tests.
- Mutation-route authorization, spoof, rate, enable/disable, and cache tests.
- Public projection tests for enabled/disabled/missing/duplicate identities and
  absence of raw IDs.
- Responsive/RTL acceptance for avatar and long mixed-script names.

## Done criteria

- [ ] Identity is anonymous by default and requires explicit verified-member consent.
- [ ] Public snapshots are server-derived, bounded, and cleared on disable.
- [ ] Website and public MCP show the same safe identity projection.
- [ ] No public response contains raw Discord/auth IDs or account data.
- [ ] Disabling identity does not affect picks, scores, profile linking, or roles.
- [ ] Privacy copy and all required repo checks pass.

## STOP conditions

- Public leaderboard code cannot batch identity without exposing lookup IDs.
- Better Auth session data does not provide a trustworthy current name/avatar.
- Cache invalidation cannot remove revoked identity promptly.
- Legal/privacy requirements demand a broader consent or retention design.

## Maintenance notes

Consent belongs to the member, not an admin. Any future public profile feature
must reuse this setting or request separate explicit consent; profile linking
alone is never permission to publish identity.

