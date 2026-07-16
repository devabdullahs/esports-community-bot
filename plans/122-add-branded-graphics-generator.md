# Plan 122: Add branded graphics generator for admins and media channels

> **Executor instructions**: Generate from stored trusted data and uploaded
> channel assets only. Do not accept arbitrary HTML, SVG, or remote image URLs.
>
> **Drift check**: `git diff --stat 27a04f8..HEAD -- src/lib/matchCard.js src/lib/ewcShareCard.js apps/web/src/components/admin/news-editor.tsx apps/web/src/lib/admin.ts`

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `27a04f8`, 2026-07-17

## Why this matters

Media teams need fast social graphics for match results, standings, and news.
The repo already has canvas rendering and logo caching; a controlled generator
can save editors time without granting arbitrary design upload power.

## Current state

- Bot-side canvas renderers exist in `src/lib/matchCard.js`,
  `src/lib/ewcShareCard.js`, and related files.
- Admin media channels have logos/colors and scoped permissions.
- Upload handling already validates image assets.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Bot tests | `npm test` | all pass |
| Focused web tests | `npm --workspace @esports-community-bot/web run test -- graphics-generator` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- Admin-only render route(s).
- Template definitions for match result, standings, and news promo cards.
- UI for scoped admins to choose template/data and download PNG.
- Rate limiting and audit logging.
- tests.

**Out of scope**:
- Arbitrary custom templates.
- User-uploaded fonts.
- Public unauthenticated rendering.
- Direct posting to social platforms.

## Steps

### Step 1: Define safe templates

Create a finite template registry with strict inputs. Source match/team/news
data server-side by id/slug; ignore client-supplied names/scores.

**Verify**: tests prove spoofed client fields do not affect rendered inputs.

### Step 2: Add admin render route

Gate by `canManageGame`/`canManageMedia` based on selected data owner. Apply
per-admin rate limits and return PNG no-store. Audit successful renders.

**Verify**: route tests cover unauthorized, wrong scope, valid render, and rate
limit.

### Step 3: Add generator UI

Add a page or panel in admin/media areas with template picker, data selector,
preview, and download. Use shadcn tabs/select/dialog patterns.

**Verify**: web tests cover template selection and scoped visibility.

## Done criteria

- [ ] Admins can generate PNGs from allowed templates.
- [ ] All inputs are server-resolved and scoped.
- [ ] No arbitrary remote image/HTML path exists.
- [ ] Full verification passes.

## STOP conditions

- Canvas rendering requires Docker/font changes not already present.
- Marketing requires arbitrary editable templates in v1.

## Maintenance notes

Keep template additions as code-reviewed changes. A database-driven template
builder is a separate, higher-risk product.
