# Plan 120: Add scheduled publishing and an editorial calendar

> **Executor instructions**: Scheduling must preserve existing draft/published
> semantics and admin/media RBAC.
>
> **Drift check**: `git diff --stat 27a04f8..HEAD -- src/db/ewcNewsPosts.js apps/web/src/components/admin/news-editor.tsx apps/web/src/app/api/admin/news src/jobs/newsAnnouncer.js`

## Status

- **Status**: DONE
- **Completed**: 2026-07-17

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `27a04f8`, 2026-07-17

## Why this matters

Media channels should be able to prepare posts ahead of match days and schedule
release times. This shortens the workflow and makes the admin dashboard more
useful for real editorial teams.

## Current state

- `src/db/ewcNewsPosts.js` supports draft/published statuses and publish time.
- `apps/web/src/components/admin/news-editor.tsx` saves drafts and publishes.
- `src/jobs/newsAnnouncer.js` posts published news to Discord.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Bot tests | `npm test` | all pass |
| Focused web tests | `npm --workspace @esports-community-bot/web run test -- scheduled-publishing` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- Add `scheduled_publish_at` and supporting indexes.
- Admin news editor schedule controls.
- Admin calendar page/view.
- Publish job that promotes due scheduled posts.
- Audit logging and tests.

**Out of scope**:
- Social network auto-posting.
- Recurring posts.
- Scheduling unpublished media channel profile changes.

## Steps

### Step 1: Add scheduled state

Add DB columns for scheduled publish time and update validation so a post can be
draft, scheduled, or published. Enforce that scheduled posts have valid future
timestamps and complete publish-ready content.

**Verify**: DB/API tests cover validation, RBAC, and status transitions.

### Step 2: Add scheduler job

Create a job that finds due scheduled posts, publishes them atomically, records
audit log rows, and lets the existing news announcer send Discord messages.

**Verify**: bot tests cover due, not-due, already-published, and failure retry.

### Step 3: Add editorial calendar UI

Add calendar/list views for admins scoped by their games/media channels. Use
shadcn calendar/date-picker patterns already present in the app.

**Verify**: web tests cover scoped admin visibility and schedule controls.

## Done criteria

- [x] Scheduled posts publish automatically at or after the configured time.
- [x] Scoped admins only see/manage their posts.
- [x] Discord announcement still happens once.
- [x] Full verification passes.

## STOP conditions

- Existing status enum cannot be extended without unsafe migration churn.
- Scheduler would double-post to Discord.

## Maintenance notes

Scheduled publishing and cross-post composer will overlap. Keep this plan
focused on website publish timing only.
