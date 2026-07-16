# Plan 123: Add keyword auto-flagging and bulk moderation

> **Executor instructions**: Moderation controls must be scoped, audited, and
> conservative. Do not auto-delete public content.
>
> **Drift check**: `git diff --stat 27a04f8..HEAD -- src/lib/commentModeration.js src/db/postComments.js apps/web/src/components/admin/comment-moderation.tsx apps/web/src/app/api/admin/comments`

## Status

- **Priority**: P2
- **Effort**: M-L
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `27a04f8`, 2026-07-17

## Why this matters

As comments expand to matches and clips, moderators need faster tools. Keyword
watchlists and bulk actions reduce manual work while keeping final judgment with
admins.

## Current state

- `src/lib/commentModeration.js` already flags comments.
- `src/db/postComments.js` stores moderation state.
- `apps/web/src/components/admin/comment-moderation.tsx` renders the queue.
- Admin audit logging exists.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Bot tests | `npm test` | all pass |
| Focused web tests | `npm --workspace @esports-community-bot/web run test -- moderation` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- Keyword/watchlist DB table.
- Admin API and UI for keyword management.
- Bulk approve/reject/hold actions.
- Tests and audit log entries.

**Out of scope**:
- Machine-learning moderation.
- Automatic permanent deletion.
- User bans; existing user moderation covers that.

## Steps

### Step 1: Add keyword rules

Store phrase, locale/scope, action (`hold` or `flag`), enabled state, creator,
and timestamps. Normalize case but preserve display text. Validate max lengths.

**Verify**: DB/API tests cover create, update, disable, duplicate, and invalid
length.

### Step 2: Apply rules on comment create/edit

Extend `commentModeration` to apply enabled rules. `hold` should make comments
pending; `flag` should preserve visible/pending behavior but add reason.

**Verify**: tests cover locale-specific and global rules.

### Step 3: Add bulk moderation

Allow selecting multiple comments in the admin queue and approving/rejecting/
holding them in one request. Audit every affected id and actor.

**Verify**: tests cover partial invalid ids and permission boundaries.

## Done criteria

- [ ] Keyword rules are configurable by admins.
- [ ] Bulk actions are audited and safe on partial failure.
- [ ] Existing single-comment moderation still works.
- [ ] Full verification passes.

## STOP conditions

- Moderation queue ownership becomes ambiguous for game/media scoped admins.

## Maintenance notes

Keep the first version simple. Add regex only after literal keyword matching is
proven insufficient.
