# Plan 115: Add one-tap match reminders

> **Executor instructions**: Match reminders are a lightweight subscription
> type. Do not force users to follow a whole team or tournament.
>
> **Drift check**: `git diff --stat 27a04f8..HEAD -- src/db/userFollows.js src/db/userNotifications.js apps/web/src/components/tournaments/tournament-match-list.tsx apps/web/src/app/api/me`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/099-add-notification-delivery-controls.md recommended
- **Category**: direction
- **Planned at**: commit `27a04f8`, 2026-07-17

## Why this matters

Sometimes users want a reminder for one match without following a team or
tournament forever. A bell on match cards makes that action obvious and reduces
notification noise.

## Current state

- Follows are entity-based: game, tournament, team, player.
- Notifications already support match start/result event rows.
- Match lists render public cards and know signed-in follow state for
  tournaments.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Bot tests | `npm test` | all pass |
| Focused web tests | `npm --workspace @esports-community-bot/web run test -- match-reminders` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- Add `match` reminder table or extend follows with a match entity type if safe.
- `apps/web/src/app/api/me/match-reminders/route.ts` (create)
- Bell UI on match cards.
- Notification fan-out update so reminders receive match start/result.
- tests.

**Out of scope**:
- Calendar integration, unless plan 103 is already merged and exposes helpers.
- Reminder offsets other than match start in v1.
- Anonymous reminders.

## Steps

### Step 1: Add reminder persistence

Store user id, match id, created_at, canceled_at. Enforce one active reminder
per user/match. Do not use raw match names as keys.

**Verify**: DB tests cover create, cancel, duplicate, and missing match.

### Step 2: Wire notification fan-out

When a match starts or finishes, include active match-reminder users in the
recipient set and dedupe against normal follows.

**Verify**: bot tests cover reminder-only delivery and follow+reminder dedupe.

### Step 3: Add UI

Add a bell button on scheduled/running match cards. For unauthenticated users,
route to login with return path. For authenticated users, optimistically toggle
with error rollback.

**Verify**: web tests cover login CTA, add, remove, and optimistic rollback.

## Done criteria

- [ ] Match reminders notify without broad follows.
- [ ] Duplicate notifications are deduped.
- [ ] UI is accessible and localized.
- [ ] Full verification passes.

## STOP conditions

- Existing notification fan-out cannot include match-specific recipients without
  rewriting unrelated follow semantics.

## Maintenance notes

Future "remind me 15 minutes before" should extend this table with an offset
column rather than creating a parallel model.
