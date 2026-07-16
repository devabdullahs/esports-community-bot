# Plan 109: Add match discussion threads

> **Executor instructions**: Reuse the existing comment/moderation model. Do
> not build a second comment system.
>
> **Drift check**: `git diff --stat 27a04f8..HEAD -- src/db/postComments.js apps/web/src/components/comments/comments-section.tsx apps/web/src/app/api/news/[postId]/comments/route.ts apps/web/src/app/matches/[id]/page.tsx`

## Status

- **Priority**: P2
- **Effort**: M-L
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `27a04f8`, 2026-07-17

## Why this matters

Live and finished matches naturally generate discussion. The site already has a
moderated comment system for news; attaching it to match pages makes match
details more social without adding a new moderation queue.

## Current state

- `src/db/postComments.js` implements one-level threaded comments, moderation
  states, reports, likes, edit/delete, and auto-approval.
- `apps/web/src/components/comments/comments-section.tsx` renders news comments.
- `apps/web/src/app/matches/[id]/page.tsx` renders public match details.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Bot tests | `npm test` | all pass |
| Focused web tests | `npm --workspace @esports-community-bot/web run test -- match-comments` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- Add a generic comment target model or extend comments to support `target_type`.
- Match comment API routes under `/api/matches/[id]/comments`.
- Reuse `CommentsSection` with a generic target prop.
- Include match comments in admin moderation.
- Tests.

**Out of scope**:
- Real-time chat.
- Nested replies beyond the existing one-level rule.
- Anonymous comments.

## Steps

### Step 1: Generalize comment targets safely

Prefer an additive `target_type`/`target_id` migration while preserving existing
news comments. Backfill news rows as `target_type='news'`. Keep unique/index
coverage for list and moderation queries.

**Verify**: bot tests prove existing news comments still work.

### Step 2: Add match routes

Add match comment routes that verify the match exists and use the same verified
member boundary, body validation, moderation, report, and like rules.

**Verify**: tests cover unauthenticated, valid comment, invalid match, report,
and moderation visibility.

### Step 3: Render on match pages

Add the comment section below match details with localized copy. Use the same
component structure to keep UX consistent.

**Verify**: web test asserts comments render on `/matches/[id]`.

## Done criteria

- [ ] News comments do not regress.
- [ ] Match comments flow through the same moderation queue.
- [ ] No anonymous write path is introduced.
- [ ] Full verification passes.

## STOP conditions

- The migration cannot preserve existing comments on both SQLite and Postgres.
- Moderation would require a separate queue to remain safe.

## Maintenance notes

If live chat is added later, keep it separate from comments and moderation. This
plan is for durable discussion threads, not real-time messaging.
