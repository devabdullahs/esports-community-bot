# Plan 078: Make notifications discoverable, live, paginated, and failure-safe

> **Executor instructions**: Preserve notification ownership checks and Discord
> delivery pacing. Follow each verification gate and update `plans/README.md`
> when complete.
>
> **Drift check (run first)**: `git diff --stat ba288a1..HEAD -- apps/web/src/components/follows apps/web/src/components/site-header-client.tsx apps/web/src/app/api/me src/db/userNotifications.js src/jobs/notifier.js apps/web/src/test tests/followNotifications.test.mjs`

## Status

- **Execution**: DONE (2026-07-10)
- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `ba288a1`, 2026-07-10

## Why this matters

The notification center loads only once and only fetches the newest 20 rows.
A match that starts while `/me` is open is invisible until a hard refresh, and
older alerts have no reachable UI. Network failures in unfollow and mark-all
paths are also not handled consistently, so an action can fail with no useful
feedback. Notifications should behave like an inbox, not a static snapshot.

## Current state

- `apps/web/src/components/follows/follow-center.tsx:77-109` performs one
  mount-only `useEffect` fetch for follows, notifications, and preferences.
- It requests `notifications?limit=20` at line 83 but renders no load-more or
  pagination action at lines 221-297.
- `unfollow` has no network `catch` at lines 111-123; `markAllRead` does not
  handle a non-OK response at lines 126-143.
- Individual read state has a useful optimistic rollback pattern at lines
  145-179. Reuse that behavior through TanStack Query mutations.
- `apps/web/src/app/api/me/notifications/route.ts:18-24` accepts limit/offset;
  `src/db/userNotifications.js:85-92` clamps limit but does not produce a
  `hasMore`/cursor response.
- `apps/web/src/components/site-header-client.tsx:284-340` has an account menu
  but no unread signal, so users must discover notifications at the bottom of
  `/me`.
- `src/jobs/notifier.js:83-129` serializes Discord DMs at 1100 ms and leaves
  inbox rows on delivery failure. Do not weaken this rate-limit behavior.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Bot notification tests | `node --test tests/followNotifications.test.mjs` | all pass |
| Focused web tests | `npm --workspace @esports-community-bot/web run test -- src/test/notifications-api.test.ts src/test/notification-model.test.ts` | all pass |
| Bot tests | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

## Scope

**In scope**:

- `apps/web/src/components/follows/follow-center.tsx`
- New focused notification inbox/badge components under the same directory
- `apps/web/src/components/site-header-client.tsx`
- `apps/web/src/app/api/me/notifications/route.ts`
- `apps/web/src/lib/i18n.ts`
- `apps/web/src/test/notifications-api.test.ts` (new)
- `apps/web/src/test/notification-model.test.ts` (new if a pure model is added)
- `src/db/userNotifications.js` and its existing test only if needed for a
  cursor/count helper

**Out of scope**:

- New notification event types, push notifications, email, or service workers.
- Discord DM spacing, retry policy, and match transition detection.
- Profile layout; plan 079 will place the finished inbox in the account hub.

## Steps

### Step 1: Make the API pagination contract explicit

Validate finite positive `limit` and non-negative finite `offset` in the route.
Fetch one sentinel row beyond the requested page or add a bounded count helper,
then return `notifications`, `unread`, and `nextOffset` (null at the end).
Never return another user's rows.

**Verify**: API tests cover invalid numbers, first/middle/final pages, unread
count, unauthorized requests, and cross-user isolation.

### Step 2: Move client state to TanStack Query

Replace the mount-only effect with stable query keys and `useInfiniteQuery` for
notifications. Refetch on window focus and at a conservative 30-60 second
interval while the page is mounted. Keep follows and preferences separately
cached so a notification refresh does not flash the whole profile.

Add a clear "Load more" action when `nextOffset` exists. Preserve scroll and
already-loaded rows during a background refresh.

**Verify**: model tests prove pages merge without duplicate IDs and newest rows
remain first.

### Step 3: Make every mutation reversible and visible

Implement mark-one, mark-all, unfollow, and preference updates as mutations
with optimistic updates, rollback snapshots, and localized errors. Clear an
old error after a later success. Disable only the row/control being changed;
do not freeze unrelated notification actions behind one global `busy` flag.

**Verify**: reject each mocked mutation once and confirm state rolls back; a
subsequent success clears the error.

### Step 4: Add a lightweight unread entry point

Add an unread badge to the account menu and its mobile equivalent for signed-in
users. Reuse the same query cache and link directly to
`/me?tab=notifications`. Do not query notifications for signed-out visitors.
Keep the badge compact and accessible with an explicit label.

**Verify**: no badge when zero/signed-out; localized count and link when
positive; header does not shift as counts change.

### Step 5: Visual and delivery acceptance

At mobile/desktop and English/Arabic, verify unread contrast, long mixed-script
titles, load-more, focus states, and mark-read while navigating. Confirm the
bot tests still prove one notification per dedupe key and paced DM delivery.

## Done criteria

- [x] Open `/me` receives new inbox rows without hard refresh.
- [x] More than 20 notifications are reachable.
- [x] Every mutation reports failure and rolls back correctly.
- [x] Header/account navigation exposes unread state without layout shift.
- [x] Ownership, dedupe, and Discord pacing are unchanged.
- [x] All required repo checks pass.

## STOP conditions

- The change requires a websocket, external queue, or push service.
- A route can no longer prove the viewer's Discord identity server-side.
- The implementation would retry failed DMs automatically; report that as a
  separate delivery-policy decision.

## Maintenance notes

Future event types must extend the DB check constraint, TypeScript union,
copy, and renderer together. Keep polling conservative; the bot is already the
source of truth and the web inbox only needs near-real-time freshness.
