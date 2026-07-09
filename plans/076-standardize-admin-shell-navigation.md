# Plan 076: Standardize the admin workspace with shadcn Sidebar and entity-aware navigation

> **Executor instructions**: This is a broad UI migration. Preserve every
> route's current authorization checks and data flow. Migrate pages
> incrementally, running lint/build after each group. Stop if generated shadcn
> files would overwrite customized primitives. Update `plans/README.md` when
> complete.
>
> **Drift check (run first)**: `git diff --stat 5091ff1..HEAD -- apps/web/src/app/admin apps/web/src/components/admin/admin-dashboard-shell.tsx apps/web/src/components/admin/admin-page-shell.tsx apps/web/src/lib/admin-copy.ts apps/web/components.json`

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: plan 074
- **Category**: direction
- **Planned at**: commit `5091ff1`, 2026-07-09

## Why this matters

The admin workspace mixes a custom sidebar, a global static breadcrumb, a
large card-shaped title block, and multiple pages with hand-built back buttons.
Dynamic routes often resolve to a generic nav label, Arabic arrows are wrong on
the manual pages, and repeated title cards waste vertical space in a daily-use
tool. A standard shadcn Sidebar plus one compact page-header contract makes the
workspace predictable on desktop/mobile and lets each server page provide the
actual game, media channel, post, or member name in its hierarchy.

## Current state

- `admin-dashboard-shell.tsx:191-324` implements custom navigation and desktop
  aside; mobile uses Sheet separately.
- `AdminBreadcrumb` at lines 246-268 looks up only the static nav map.
- `admin-page-shell.tsx:61-87` wraps every page title in a large floating Card.
- These pages bypass `AdminPageShell` and repeat `<main>`, back button, and title:
  - `app/admin/games/[slug]/page.tsx`
  - `app/admin/games/new/page.tsx`
  - `app/admin/media/[slug]/page.tsx`
  - `app/admin/media/new/page.tsx`
  - `app/admin/news/new/page.tsx`
  - `app/admin/news/new/media/page.tsx`
  - `app/admin/news/[id]/page.tsx`
  - `app/admin/users/[discordId]/page.tsx`
- Their `ArrowLeftIcon` instances omit `rtl:rotate-180`.
- The repo is shadcn `base-nova` with RTL and Base UI; Sidebar is not installed.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Inspect registry | `cd apps/web; npx shadcn@latest info --json` | Base UI `base-nova`, RTL true |
| Add components | `cd apps/web; npx shadcn@latest add sidebar empty` | exit 0; expected generated files only |
| Shell tests | `npm --workspace @esports-community-bot/web run test -- src/test/admin-navigation-model.test.ts` | all pass |
| Bot tests | `npm test` | exit 0 |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |
| Find old manual shells | `rg -n "<main className=\"mx-auto.*admin|ArrowLeftIcon" apps/web/src/app/admin` | no duplicate manual page shell/back-button matches after migration |

## Suggested executor toolkit

- Invoke the `shadcn` skill. Read the official Sidebar, Breadcrumb, Empty,
  Skeleton, Field, and Base UI composition docs before editing.
- Use `@shadcn/dashboard-01` only as a structural reference for an operational
  dashboard. Do not copy its content blindly or turn every section into a card.
- Use browser automation/screenshots for mobile, desktop, and Arabic RTL.

## Scope

**In scope**:

- `apps/web/src/components/ui/sidebar.tsx` (generated)
- `apps/web/src/components/ui/empty.tsx` (generated if absent)
- `apps/web/src/hooks/use-mobile.ts` (generated if required)
- `apps/web/src/components/admin/admin-dashboard-shell.tsx`
- `apps/web/src/components/admin/admin-page-shell.tsx`
- `apps/web/src/lib/admin-navigation-model.ts` (new)
- `apps/web/src/lib/admin-copy.ts`
- `apps/web/src/app/admin/page.tsx`
- `apps/web/src/app/admin/games/[slug]/page.tsx`
- `apps/web/src/app/admin/games/new/page.tsx`
- `apps/web/src/app/admin/media/[slug]/page.tsx`
- `apps/web/src/app/admin/media/new/page.tsx`
- `apps/web/src/app/admin/news/new/page.tsx`
- `apps/web/src/app/admin/news/new/media/page.tsx`
- `apps/web/src/app/admin/news/[id]/page.tsx`
- `apps/web/src/app/admin/users/[discordId]/page.tsx`
- Other `apps/web/src/app/admin/**/page.tsx` files only when required to adopt
  the new `AdminPageShell` prop contract
- `apps/web/src/test/admin-navigation-model.test.ts` (new)
- `package-lock.json` only if shadcn legitimately changes dependencies

**Out of scope**:

- Public-site navigation/back behavior.
- Changing RBAC, redirects, queries, mutations, or editor internals.
- New dashboard metrics or backend endpoints.
- A marketing-style admin landing page.
- Autosave and unsaved-navigation logic beyond preserving plan 074.

## Git workflow

- Branch: `codex/076-standardize-admin-shell`
- Commit in reviewable groups: generated Sidebar, shell/header, route migrations,
  then visual polish/tests.
- Example commit: `Standardize admin workspace navigation`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Install shadcn Sidebar without overwriting local primitives

Run the add command from `apps/web` and inspect `git diff --stat` immediately.
Accept only the new Sidebar/Empty/mobile-hook files and legitimate dependency
metadata. If the CLI wants to replace customized Button, Sheet, Tooltip,
Skeleton, Input, or Separator, decline and integrate imports manually.

Use Base UI APIs from the generated files. Never paste Radix examples with
`asChild`; this repo composes links with `render` and
`nativeButton={false}`.

**Verify**: web lint and build pass before wiring the new component.

### Step 2: Extract a pure role-aware navigation model

Move `navSections`, item matching, and localized labels into
`admin-navigation-model.ts`. Inputs remain locale, super-admin status, and
whether game/media posting is available. Add tests for:

- scoped versus super sections;
- active matching, including exact `/admin` and nested dynamic routes;
- MCP keys visible to all approved admins;
- super-only analytics/users/team/audit entries;
- English and Arabic labels.

The model is data only and may not import React, Next navigation hooks, or DB
code.

**Verify**: navigation-model tests pass.

### Step 3: Replace custom aside and mobile Sheet with shadcn Sidebar

Refactor `AdminDashboardShell` to use `SidebarProvider`, `Sidebar`, grouped
menu primitives, footer, `SidebarInset`, and `SidebarTrigger`. Preserve:

- current role-based item visibility;
- active `aria-current` state;
- Home action;
- display name and role in the top bar/footer;
- plan 074's navigation guard provider;
- Arabic sidebar side/direction and logical borders.

Use icon-only collapse controls with Tooltip. Desktop may collapse to icons;
mobile uses Sidebar's built-in off-canvas behavior. Remove the duplicate custom
Sheet implementation once parity is established.

**Verify**: lint/build pass; keyboard can open/close mobile sidebar and focus
returns to trigger.

### Step 4: Replace global static breadcrumb with page-owned hierarchy

Remove `AdminBreadcrumb` from the top shell. Extend `AdminPageShell` with a
`breadcrumbs` array:

```ts
type AdminCrumb = { label: string; href?: string };
```

Render shadcn Breadcrumb in the page content, where each server page already
has entity data. The final crumb is `BreadcrumbPage`; preceding crumbs are
links. Derive the optional compact back action from the nearest preceding
linked crumb so back label/href and breadcrumb cannot disagree.

Dynamic examples:

- Admin > Games > `<localized game title>`
- Admin > Media channels > `<localized channel name>`
- Admin > Media channels > `<channel>` > New post
- Admin > Games > `<game>` > `<post title or Edit post>`
- Admin > Users > `<member display name>`
- Admin > MCP keys

Literal IDs/tool names remain LTR inside RTL pages. All directional icons use
logical placement and `rtl:rotate-180`.

**Verify**: build passes for every dynamic route.

### Step 5: Make `AdminPageShell` compact and unframed

Remove the title Card. Render an unframed page header with:

- breadcrumb/back row;
- optional eyebrow/badge;
- compact `h1` sized for a workspace, not a hero;
- short description;
- responsive actions aligned to the inline end.

Keep max-width options and stable responsive spacing. Do not add a floating
card around the page section, and do not nest cards. Use cards only for
individual repeated records or genuinely framed tools.

**Verify**: no title/header Card remains in `AdminPageShell`; lint/build pass.

### Step 6: Migrate every manual admin page

Replace the repeated `<main>`, ArrowLeft, and title blocks listed in Current
state with `AdminPageShell`. Preserve all access checks and editor/list props
exactly. Use localized entity labels in breadcrumbs and semantic parent links.

For empty collections, use shadcn Empty with one clear action. Keep dense lists
as tables/lists instead of introducing decorative cards. Update
`app/admin/page.tsx` to follow the same compact page-header rhythm and use the
dashboard block pattern for shortcuts/metrics without a hero card.

**Verify**: the old-shell `rg` command returns no unintended matches and build
generates all admin routes.

### Step 7: Responsive and RTL visual verification

Seed a disposable DB and run the web app:

```powershell
$env:DB_PATH="$env:TEMP\ecb-admin-shell.sqlite"
npm run seed:dev
npm run web:dev
```

Capture/check at 390x844, 768x1024, and 1440x900 in English and Arabic:

- no horizontal overflow or text overlap;
- sidebar opens, closes, collapses, and shows tooltips;
- active item and role-based items are correct;
- breadcrumbs show actual entity names and logical arrow direction;
- page title starts near content with no empty top/bottom card gaps;
- sticky news action bar does not collide with sidebar/mobile browser chrome;
- plan 074 dirty-navigation confirmation still works from sidebar links;
- all controls are keyboard reachable with visible focus.

## Test plan

- Pure nav model exact sections and active matching.
- Existing page/auth tests remain green, proving RBAC and redirects unchanged.
- Build covers dynamic admin routes and server/client boundaries.
- Browser screenshots cover desktop/mobile and LTR/RTL.
- Manual dirty-draft scenario confirms plan 074 survives Sidebar migration.

## Done criteria

- [ ] One shadcn Sidebar handles desktop, mobile, grouping, and collapse.
- [ ] One compact unframed `AdminPageShell` handles admin page headings.
- [ ] Dynamic pages supply entity-aware breadcrumbs and matching back targets.
- [ ] Every repeated manual shell listed above is migrated.
- [ ] Arabic direction and arrow behavior are correct.
- [ ] RBAC/data behavior is unchanged.
- [ ] No nested cards or mobile horizontal overflow are introduced.
- [ ] All required repo checks pass.
- [ ] Plan 076 is marked DONE.

## STOP conditions

- The shadcn CLI proposes overwriting a customized component.
- A page migration requires changing its authorization or query behavior.
- Sidebar's generated API differs from the plan; inspect official Base UI docs
  and report rather than using Radix-only props.
- Plan 074's guard cannot wrap Sidebar links without regression.
- Dynamic breadcrumbs would require exposing server-only entity data to a
  global client store; keep page-owned breadcrumbs and report the conflict.

## Maintenance notes

New admin routes should use `AdminPageShell` and provide breadcrumbs from their
server-loaded entity data. Add nav items only through the pure model. Reviewers
should inspect mobile/RTL screenshots and verify no RBAC condition was lost in
the visual migration.

