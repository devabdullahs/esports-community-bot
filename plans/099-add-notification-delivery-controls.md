# Plan 099: Add quiet hours, digest delivery, and per-follow notification controls

> **Executor instructions**: Execute in order. Notifications are durable user
> data: preserve inbox rows, dedupe keys, Discord pacing, and ownership even if
> DM delivery is delayed or grouped. Use injected clocks in tests; never make
> time-dependent tests sleep. The reviewer owns roadmap status.
>
> **Mandatory dependency gate (before drift check)**: Plan 098 must have an
> approved review verdict and be the worktree base. Verify with
> `git merge-base --is-ancestor 7a5fc6117d5196a29a356b04033daace26e33b20 HEAD` from the new worktree.
> Its follow-model/API changes are approved baseline, not drift. Stop if the
> dependency is unavailable; do not recreate or parallelize `/follow` work.
>
> **Drift check (run second)**: record Plan 098's expected changed-file list,
> then run `git diff --stat 7a5fc6117d5196a29a356b04033daace26e33b20..HEAD -- src/db/userFollows.js src/db/userNotifications.js src/jobs/notifier.js src/db/index.js scripts/postgres/schema.sql apps/web/src/app/api/me/follows/route.ts apps/web/src/app/api/me/notification-prefs/route.ts apps/web/src/components/follows apps/web/src/lib/follows.ts tests/followNotifications.test.mjs apps/web/src/test/notifications-api.test.ts`.
> Stop on an unexpected change to dedupe, DM status, or follow matching
> contracts.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: Plan 098
- **Category**: direction / feature / migration
- **Planned at**: commit `1530ee8`, 2026-07-14

## Why this matters

Members currently choose only whether DMs, match starts, and match results are
enabled globally. A user following many entities can receive bursts at
inconvenient local times, with no way to mute one noisy follow. This plan keeps
the website inbox immediate and durable while adding controlled Discord
delivery: instant or daily digest, quiet hours, and per-follow event overrides.

## Current state

- `user_notification_prefs` has only `dm_enabled`, `notify_match_start`, and
  `notify_match_result` in both DB schemas.
- `src/db/userNotifications.js` inserts one deduped inbox/outbox row per user.
  `dm_status` is decided at enqueue time and is one of
  `pending|sent|skipped|failed`.
- `src/jobs/notifier.js` serially drains `pending` rows, sleeps 1100 ms between
  DMs, caps each drain at 100, treats Discord 50007 as skipped, and never
  retries failed rows. Preserve those rate and failure semantics.
- `src/db/userFollows.js:listFollowerIdsForMatch` collapses all matching follow
  paths to a set of user IDs; it currently loses which follow matched.
- `PATCH /api/me/notification-prefs` accepts only three booleans and is guarded
  by same-origin plus signed-in ownership.
- `FollowCenter` renders three optimistic toggles. Its API client and tests are
  the UI patterns to extend.

## Product rules

1. Website inbox rows are created immediately whenever the effective event
   preference allows the event, regardless of DM mode/quiet hours.
2. Global event toggles are the default. Each follow may override Start and
   Result independently with `inherit`, `on`, or `off`.
3. If multiple follows match one event, notify when **any** matching follow's
   effective setting is on. One muted team follow must not suppress an enabled
   tournament follow for the same match.
4. DM mode is `instant` or `daily_digest`. Digest sends once per local day at a
   configured local minute (default 18:00).
5. Quiet hours use a validated IANA timezone and local start/end minutes;
   equal/missing boundaries mean disabled. Windows crossing midnight work.
6. Instant DMs queued during quiet hours wait until quiet end. Digest delivery
   chooses the next digest time outside quiet hours.
7. Existing rows/defaults remain instant with quiet hours disabled.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused bot tests | `node --test tests/followNotifications.test.mjs tests/notificationSchedule.test.mjs` | all pass |
| Focused web tests | `npm --workspace @esports-community-bot/web run test -- notifications-api notification-delivery-controls` | all pass |
| Bot tests | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Native typecheck | `npm --workspace @esports-community-bot/web run typecheck:native` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- `src/db/index.js`
- `scripts/postgres/schema.sql`
- `src/db/userFollows.js`
- `src/db/userNotifications.js`
- `src/jobs/notifier.js`
- `src/lib/notificationSchedule.js` (create; pure clock/timezone logic)
- `apps/web/src/lib/follows.ts`
- `apps/web/src/app/api/me/notification-prefs/route.ts`
- `apps/web/src/app/api/me/follows/route.ts`
- `apps/web/src/components/follows/notification-client.ts`
- `apps/web/src/components/follows/follow-center.tsx`
- installed shadcn time/select/popover components only as needed
- `apps/web/src/lib/i18n.ts`
- `tests/followNotifications.test.mjs`
- `tests/notificationSchedule.test.mjs` (create)
- web notification tests/components under `apps/web/src/test/`
- Plan 098 `/follow` response copy only to link users to advanced settings

**Out of scope**:
- Email, push notifications, SMS, multiple daily digests, or admin broadcasts.
- Retrying `failed` DMs automatically.
- Per-game Discord channels or role mentions.
- User-entered timezone abbreviations or fixed UTC offsets.
- Changing inbox pagination/read semantics.

## Git workflow

- Work only in a separate worktree (or clean clone) based on the approved Plan
  098 commit, on `codex/099-notification-controls`. Never commit from the
  dirty operator checkout and never use `git clean`, `git stash`, reset, or
  checkout there.
- Commit in logical units: schema/model, delivery job, web API/UI.
- Example: `feat(notifications): add quiet hours and digest delivery`.

## Steps

### Step 1: Add additive dual-backend schema

Add nullable per-follow columns `notify_match_start` and
`notify_match_result` (NULL=inherit, 0=off, 1=on). Add preference columns:
`dm_delivery_mode` (`instant` default), `timezone` (`Asia/Riyadh` default),
`quiet_start_minute`, `quiet_end_minute`, and `digest_minute` (1080 default).
Add notification columns `dm_delivery_mode` and `dm_not_before` unix seconds.
Keep existing `dm_status` values so no destructive CHECK rebuild is needed.
Add an index on `(dm_status, dm_not_before, id)`. Implement equivalent SQLite
`ensureColumns` and Postgres schema/migrations. The additive migration must
also repair legacy pending rows explicitly and idempotently: set
`dm_delivery_mode = 'instant'` where it is NULL, and set `dm_not_before = 0`
where `dm_status = 'pending'` and it is NULL. Do not alter historical sent,
skipped, or failed rows merely to fill a delivery timestamp.

**Verify**: disposable SQLite migration from the old schema preserves rows and
defaults; schema parity test asserts all new columns/indexes in both backends.
Seed a pre-migration pending notification, apply the migration, and prove it is
selected and delivered rather than stranded by a NULL due time.

### Step 2: Implement pure timezone scheduling

Create pure functions using built-in `Intl.DateTimeFormat` and validated IANA
zones (construct formatter in try/catch). Given `nowSec` and preferences,
compute whether local time is quiet, next quiet end, and next digest time
outside quiet hours. Correctly handle crossing midnight, 00:00/23:59, DST
transitions, and invalid zones falling back to `Asia/Riyadh`. Cache formatters
by bounded timezone string.

**Verify**: deterministic tests cover Riyadh, a DST zone before/after changes,
cross-midnight quiet window, equal/disabled window, digest-inside-quiet, and
invalid timezone. No sleeps or current clock calls inside tested functions.

### Step 3: Preserve matching follows and calculate effective event policy

Add a new bounded function returning recipients plus all matching follow rows,
or evolve the existing matcher while retaining `listFollowerIdsForMatch` as a
compatibility projection. Apply global event setting first, then nullable
per-follow overrides. OR effective permission across matching follows. Preserve
team normalization, player game gating, and duplicate user collapse.

**Verify**: tests cover inherit/on/off, two matching follows with conflicting
overrides, both off, player/team overlap, and unchanged legacy behavior.

### Step 4: Queue inbox rows with a delivery schedule

At enqueue time, always create the inbox row when the event is effectively
enabled. If DMs are disabled, status is `skipped`. Otherwise status is
`pending`, mode is copied from current prefs, and `dm_not_before` is computed:
now/outside quiet for instant, quiet end for instant during quiet hours, or next
valid digest time for digest. Dedupe key remains unchanged. Inject `nowSec` for
tests. Do not rewrite already queued rows when preferences later change.

**Verify**: tests assert inbox immediacy, exact not-before timestamps, dedupe,
disabled DM, and preference changes do not mutate historical rows.

### Step 5: Drain due instant rows and group due digests safely

Change pending selection to only due rows (`dm_not_before <= now`). Preserve
the notifier module's existing single-process `draining` reentrancy guard:
every instant and digest query/update must run under the same `drainDmQueue`
owner so two in-process cron/manual calls cannot send a row twice. This service
is deployed as one bot process; STOP and request a distributed-claim design if
that deployment assumption changes. Drain instant rows with current pacing.
Group digest rows by user, cap a digest to a
safe number of entries/Discord message length, include omitted-count + website
link, and mark all rows represented by a successfully sent digest as sent in
one transaction. On 50007 mark represented rows skipped; on transient failure
mark them failed, matching existing no-retry policy. Do not hold a DB
transaction during a Discord network call.

If more digest rows exist than fit one message, send bounded sequential chunks
under the same 1100 ms pacing and update only each successful chunk.

**Verify**: tests cover not-yet-due exclusion, one digest per user, chunking,
mixed instant/digest users, closed DM, transient failure, the preserved
concurrent drain guard, and exact status transitions.

### Step 6: Harden and extend member APIs

Use `readBoundedJson` instead of unbounded `request.json()` in notification
preferences. Validate exact allowed fields, mode enum, timezone <=64 chars and
accepted by Intl, minute integers 0-1439, and paired quiet boundaries. Add
same-origin/rate-limit behavior matching follows. Extend follow PATCH (or a
dedicated `/api/me/follows/[id]` route) to update only the signed-in owner's
nullable overrides by numeric follow ID; never accept Discord user ID.

**Verify**: API tests cover unauthorized, cross-origin, oversized/malformed,
invalid timezone/minutes/mode, partial patch concurrency, cross-user follow ID,
and valid reset-to-inherit.

### Step 7: Redesign settings and per-follow controls

In `FollowCenter`, keep the three global toggles, then add:

- DM delivery segmented control (Instant / Daily digest);
- timezone searchable select populated from `Intl.supportedValuesOf("timeZone")`
  with a conservative fallback list;
- shadcn time inputs for quiet start/end and digest time;
- a clear "Quiet hours off" toggle/reset;
- per-follow compact menu with Start/Result each Inherit/On/Off.

Show the user's local preview of next delivery, preserve optimistic rollback,
and disable dependent controls when DMs are off. Use native/localized time
formatting, logical properties, mobile sheets/popovers that keep options in
view, and EN/AR copy. Do not put a card inside each follow card.

**Verify**: component tests cover state dependencies, optimistic success/error
rollback, inherit reset, mobile interaction, and RTL alignment.

### Step 8: Run full gates and operational review

Run every command. Inspect generated SQL on both backends. Add sanitized logs
for digest counts and failures, never user content or tokens. Document no new
environment variables unless a genuinely operator-controlled default is
introduced; defaults belong in schema/code.

## Test plan

- `tests/notificationSchedule.test.mjs`: pure clock/timezone cases.
- Extend `tests/followNotifications.test.mjs`: schema migration, effective
  per-follow policy, due selection, digest grouping/chunking, statuses.
- Web API tests: auth, CSRF, body cap, exact validation, ownership.
- Component tests: every settings state, error rollback, EN/AR mobile layout.
- Regression: legacy user with no preference row still gets instant DMs and
  website inbox exactly as before.

## Done criteria

- [ ] Existing users retain instant delivery and no quiet hours.
- [ ] Inbox rows remain immediate/deduped; only DM timing changes.
- [ ] Quiet hours and daily digest are correct across midnight and DST.
- [ ] Per-follow conflicts use documented OR semantics.
- [ ] Digest messages obey Discord size/rate limits and status updates are
      transactional after successful sends.
- [ ] APIs are bounded, same-origin, owner-scoped, and fail closed.
- [ ] SQLite/Postgres parity and all repository gates pass.

## STOP conditions

- SQLite migration requires destructive recreation of notification tables.
- Accurate timezone behavior would require accepting arbitrary code/format
  strings or an unreviewed large dependency.
- Digest delivery cannot identify exactly which rows a successful message
  represented.
- Any DB transaction would need to remain open while calling Discord.
- The existing failed-DM no-retry product rule must change.

## Maintenance notes

Scheduling is captured at enqueue time by design; changing preferences affects
future rows only. Reviewers should focus on cross-user ownership, crossing-
midnight/DST tests, OR semantics for overlapping follows, Discord chunk limits,
and not-before indexing. A future retry policy needs its own plan with attempt
counts and backoff.
