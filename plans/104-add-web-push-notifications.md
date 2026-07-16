# Plan 104: Add opt-in web push notifications

> **Executor instructions**: Follow this plan step by step. Web push touches
> browser permissions and server-side delivery; keep it opt-in and fail-closed.
>
> **Drift check**: `git diff --stat 27a04f8..HEAD -- src/db/userNotifications.js apps/web/src/components/follows apps/web/src/app/api/me/notifications apps/web/src/lib/follows.ts .env.example`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plans/099-add-notification-delivery-controls.md
- **Category**: direction
- **Planned at**: commit `27a04f8`, 2026-07-17

## Why this matters

The site already has match notifications and Discord delivery. Web push adds a
mobile-friendly delivery path for users who do not watch Discord all day. The
feature must be opt-in, revocable, rate-limited, and respectful of quiet hours
from plan 099.

## Current state

- `src/db/userNotifications.js` queues notification rows and pending DM status.
- `apps/web/src/components/follows/notification-inbox.tsx` manages the in-site
  inbox and mark-read behavior.
- `.env.example` is the canonical place for new environment variables.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Bot tests | `npm test` | all pass |
| Focused web tests | `npm --workspace @esports-community-bot/web run test -- push-notifications` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- DB schema additions in `src/db/index.js` for push subscriptions.
- New DB helper `src/db/userPushSubscriptions.js`.
- `apps/web/src/app/api/me/push-subscriptions/route.ts`.
- `apps/web/src/components/follows/push-notification-settings.tsx`.
- A service worker file under `apps/web/public/`.
- A push delivery job under `src/jobs/` that consumes existing notifications.
- `.env.example`.

**Out of scope**:
- Native mobile apps.
- Push for anonymous users.
- Marketing pushes unrelated to follows/predictions.
- Bypassing plan 099 quiet hours and per-follow settings.

## Steps

### Step 1: Add VAPID configuration and subscription storage

Add env vars for public/private VAPID keys and subject. Store endpoint,
encrypted keys, user ID, created/updated time, last failure, and revoked time.
Never log full endpoints or keys.

**Verify**: tests cover create, replace, revoke, and no secret logging.

### Step 2: Add browser opt-in UI

Add a settings card that explains match/deadline push notifications and only
requests `Notification` permission after a user clicks. If permission is denied,
show a useful disabled state. Respect locale and RTL.

**Verify**: web tests cover unsupported browser, denied, and subscribed states.

### Step 3: Add delivery job

Use a standard Web Push library only if already acceptable to add; otherwise
STOP for dependency approval. The job should send pending notifications that are
eligible under quiet hours and mark push delivery result independently from DM
delivery. Remove permanently gone subscriptions.

**Verify**: bot tests cover successful send, gone subscription cleanup, and
quiet-hours skip.

## Test plan

- DB tests for subscription lifecycle.
- API tests for auth, shape validation, and owner boundary.
- Delivery tests with a mocked push sender.
- Manual HTTPS browser test on staging/production because service workers
  require secure contexts.

## Done criteria

- [ ] Users can opt in and opt out.
- [ ] Push sends only existing notification events.
- [ ] Secrets are env-backed and absent from responses/logs.
- [ ] All verification commands pass.

## STOP conditions

- VAPID keys are unavailable in the deployment environment.
- Adding a web-push dependency is not approved.
- Plan 099 is not merged and quiet-hours semantics are still unsettled.

## Maintenance notes

Monitor browser delivery failures after launch. Push can easily become noisy;
review all copy and defaults with community moderators before enabling broadly.
