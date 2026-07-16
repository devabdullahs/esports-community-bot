# Plan 121: Add per-post analytics for media channels

> **Executor instructions**: Show aggregate analytics only. Do not expose raw
> visitor IDs or event-level rows to media admins.
>
> **Drift check**: `git diff --stat 27a04f8..HEAD -- apps/web/src/lib/web-analytics.ts apps/web/src/app/api/analytics/event/route.ts apps/web/src/app/admin/analytics/page.tsx apps/web/src/lib/admin.ts`

## Status

- **Priority**: P1
- **Effort**: M-L
- **Risk**: MED
- **Depends on**: plans/095-add-consent-aware-product-analytics.md
- **Category**: direction
- **Planned at**: commit `27a04f8`, 2026-07-17

## Why this matters

Media channels need to know which posts perform, where readers come from, and
what to improve. The site already tracks privacy-safe product analytics; scoped
post analytics turn that into actionable dashboards.

## Current state

- `apps/web/src/components/analytics/analytics-tracker.tsx` sends pageview and
  engagement events.
- `apps/web/src/app/api/analytics/event/route.ts` validates and stores events.
- Admin RBAC lives in `apps/web/src/lib/admin.ts`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `npm --workspace @esports-community-bot/web run test -- media-analytics` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- Aggregate analytics query helpers.
- Admin/media analytics pages and API routes.
- Tests for RBAC and aggregation.

**Out of scope**:
- Raw event export.
- Cross-site ad attribution.
- Personal user-level analytics.

## Steps

### Step 1: Add post-level aggregate queries

Aggregate views, unique visitors, average engagement, referrers, countries if
already collected, and date buckets by post path/post id. Return only aggregates.

**Verify**: tests prove no visitor/session ids in responses.

### Step 2: Add scoped admin API

Game admins see their game posts; media admins see their media posts; super
admins see all. Use existing `canManageGame` and `canManageMedia`.

**Verify**: authorization matrix tests cover forbidden cross-channel access.

### Step 3: Add dashboard UI

Add per-post stats in media channel admin pages and a comparison table. Use
Recharts and existing admin analytics styling.

**Verify**: web tests cover empty, one post, and multiple posts.

## Done criteria

- [ ] Media admins see only their own post analytics.
- [ ] Aggregates never include raw visitor identifiers.
- [ ] Analytics respects consent mode data availability.
- [ ] Full verification passes.

## STOP conditions

- Plan 095 analytics storage is not merged or does not contain usable path data.

## Maintenance notes

This data supports sponsored placements later. Keep aggregate query names stable.
