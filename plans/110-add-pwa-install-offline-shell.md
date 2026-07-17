# Plan 110: Add PWA install support and an offline shell

> **Executor instructions**: Keep the PWA small. Do not cache authenticated or
> admin responses.
>
> **Drift check**: `git diff --stat 27a04f8..HEAD -- apps/web/src/app/layout.tsx apps/web/src/app/manifest.ts apps/web/public apps/web/next.config.ts`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/104-add-web-push-notifications.md optional
- **Category**: direction
- **Planned at**: commit `27a04f8`, 2026-07-17

## Why this matters

The audience is mobile-heavy. PWA install support gives the website an app-like
entry point and creates the foundation for web push without shipping a native
app.

## Current state

- The app already has public routes, icons/assets, and optional analytics.
- There is no confirmed PWA manifest/offline route in the plan context.
- Admin and authenticated pages must not be cached by a service worker.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- `apps/web/src/app/manifest.ts` or update existing manifest.
- `apps/web/src/app/offline/page.tsx` (create).
- `apps/web/public/sw.js` (create) if no framework-managed worker exists.
- Public layout metadata for icons/theme color.
- Tests for manifest output where practical.

**Out of scope**:
- Offline match data sync.
- Caching `/admin`, `/me`, `/api`, auth routes, or MCP endpoints.
- Native app wrappers.

## Steps

### Step 1: Add manifest and install metadata

Define name, short_name, icons, start_url, scope, display, background_color, and
theme_color. Keep routes locale-safe; start at `/`.

**Verify**: build succeeds and `/manifest.webmanifest` or Next manifest route
returns valid JSON.

### Step 2: Add offline shell

Add a small offline page with links users can retry from. Service worker should
only cache the app shell and static assets. For navigations, return the offline
page only when network fails.

**Verify**: manual browser test in devtools offline mode shows offline page and
does not cache authenticated pages.

### Step 3: Add install CTA only when useful

If adding an install CTA, make it unobtrusive and hide it after dismissal. Do
not block content.

**Verify**: no layout shift on desktop/mobile.

## Done criteria

- [ ] Manifest validates and icons load.
- [ ] Offline fallback works for public navigations.
- [ ] Admin/auth/API routes are not cached.
- [ ] Verification commands pass.

## STOP conditions

- Service worker conflicts with Next build output or deployment routing.
- Required icon assets are missing and cannot be generated in this plan.

## Maintenance notes

If plan 104 adds push, merge service-worker responsibilities carefully to avoid
two workers fighting over install/fetch events.
