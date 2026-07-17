# Plan 117: Add moderated highlight and clip submissions

> **Executor instructions**: Treat submitted links as untrusted content.
> Validate hosts, moderate before public display, and never embed arbitrary HTML.
>
> **Drift check**: `git diff --stat 27a04f8..HEAD -- src/db/commentReports.js apps/web/src/components/admin/comment-moderation.tsx apps/web/src/lib/admin.ts apps/web/src/app/api/admin/comments`

## Status

- **State**: Deferred - the explicit legal/copyright STOP condition is unresolved. Current Terms do not define submitter rights, copyright responsibility, or a takedown process for third-party clips.
- **Priority**: P3
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `27a04f8`, 2026-07-17

## Why this matters

Community-submitted highlights create content without requiring editors to catch
every moment live. Moderation is essential because links and titles are
user-generated.

## Current state

- The site already has comment moderation, report holds, and admin queues.
- Public pages can render safe links and images through existing URL policies.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Bot tests | `npm test` | all pass |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- DB tables for highlight submissions and moderation state.
- Authenticated submission route.
- Public approved highlights page.
- Admin moderation panel or queue integration.
- tests.

**Out of scope**:
- Video file uploads.
- Downloading/rehosting clips.
- Arbitrary iframe embeds.
- Copyright moderation automation.

## Steps

### Step 1: Add submission model

Store submitter, URL, title, optional match/team/player references, status,
moderation fields, and timestamps. Validate allowed hosts such as Twitch,
YouTube, Kick, X/Twitter, and platform clip URLs. Store normalized URL only.

**Verify**: DB/API tests cover valid host, invalid host, path traversal-looking
URL, duplicate, and status transitions.

### Step 2: Add submit UI

Add "Submit highlight" actions from match pages and a standalone page. Keep
copy clear that submissions are reviewed before public display.

**Verify**: web tests cover authenticated and unauthenticated flows.

### Step 3: Add moderation and public page

Moderators approve/reject with optional reason. Public page shows only approved
items, safe outbound links, no arbitrary embed HTML.

**Verify**: tests prove pending/rejected submissions are hidden publicly.

## Done criteria

- [ ] Only approved links are public.
- [ ] Host allowlist is strict.
- [ ] Admin actions are audited.
- [ ] Full verification passes.

## STOP conditions

- Product requires file uploads or automatic video mirroring.
- Legal/copyright policy is undecided.

## Maintenance notes

Start link-only. Embeds can be added later per host with explicit allowlisted
components.
