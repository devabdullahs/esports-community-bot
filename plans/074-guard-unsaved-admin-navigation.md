# Plan 074: Confirm client-side admin navigation when a news draft is dirty

> **Executor instructions**: Preserve successful save/delete navigation and the
> existing hard-navigation warning. Implement the shared guard without monkey
> patching Next.js internals. Run every verification and update the plan index.
>
> **Drift check (run first)**: `git diff --stat 5091ff1..HEAD -- apps/web/src/app/admin/layout.tsx apps/web/src/components/admin/admin-dashboard-shell.tsx apps/web/src/components/admin/news-editor.tsx apps/web/src/components/ui/confirm-dialog.tsx apps/web/src/lib/admin-copy.ts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `5091ff1`, 2026-07-09

## Why this matters

The editor warns on tab close and hard navigation, but a normal Next.js link in
the admin sidebar bypasses `beforeunload` and discards the draft immediately.
The guard should cover all same-origin anchor navigation inside the admin
workspace, use the existing localized shadcn dialog, and leave save shortcuts
and programmatic post-save redirects untouched.

## Current state

- `news-editor.tsx:757-770` computes `isDirty` and only registers
  `beforeunload`.
- `admin-dashboard-shell.tsx:219-237` renders direct Next `<Link>` elements.
- `news-editor.tsx:692-720` navigates with `router.push` after successful save
  or delete; those paths must not prompt.
- `apps/web/src/components/ui/confirm-dialog.tsx` is the established Base UI
  confirmation wrapper.
- Vitest runs in `environment: "node"`; do not assume a DOM test harness exists.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Guard unit test | `npm --workspace @esports-community-bot/web run test -- src/test/admin-navigation-guard.test.ts` | all pass |
| Bot tests | `npm test` | exit 0 |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

## Suggested executor toolkit

- Use the `shadcn` skill to verify Base UI dialog/button composition. In this
  repo, use `render` and `nativeButton={false}` rather than Radix `asChild`.
- Use browser automation if available for the acceptance check after tests.

## Scope

**In scope**:

- `apps/web/src/components/admin/admin-navigation-guard.tsx` (new)
- `apps/web/src/lib/admin-navigation.ts` (new pure click-classification helper)
- `apps/web/src/components/admin/admin-dashboard-shell.tsx`
- `apps/web/src/components/admin/news-editor.tsx`
- `apps/web/src/lib/admin-copy.ts`
- `apps/web/src/test/admin-navigation-guard.test.ts` (new)

**Out of scope**:

- Autosave or draft recovery.
- Browser back/forward interception; retain `beforeunload` for document exits.
- Other editor types until they expose an actual dirty-state bug.
- Admin sidebar redesign, which is plan 076.

## Git workflow

- Branch: `codex/074-guard-unsaved-admin-navigation`
- Commit example: `Guard dirty admin drafts during navigation`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Extract deterministic anchor-intent classification

Create `admin-navigation.ts` with a pure function that accepts serializable link
intent fields and returns whether it is a navigable same-origin document link.
It must reject modified clicks, non-primary buttons, downloads, `_blank`/other
targets, hash-only movement on the same URL, mail/tel/javascript URLs, and
cross-origin destinations. It must accept normal same-origin absolute and
relative URLs.

This helper allows meaningful node-environment tests without introducing
jsdom.

**Verify**: guard unit test passes all accepted/rejected cases.

### Step 2: Add a shared admin navigation guard provider

Create a client provider/hook pair that lives inside `AdminDashboardShell` and
tracks dirty sources by stable ID (a `Set` or `Map`, not one boolean that one
component can accidentally clear for another). While any source is dirty:

- keep the existing `beforeunload` behavior;
- listen for document clicks in capture phase;
- find the closest anchor and classify it with the pure helper;
- prevent the eligible navigation, save the destination, and open
  `ConfirmDialog`;
- on Cancel, stay on the page;
- on Discard and continue, clear/ignore the pending guard once and call
  `router.push(destination)`.

Do not patch `router.push`, `history`, or Next internals. Do not intercept
buttons that happen to contain text.

Add localized title/body/actions in `admin-copy.ts`.

**Verify**: web lint and build pass.

### Step 3: Register NewsEditor dirty state

Replace the editor-local `beforeunload` effect with the shared hook. Register
`isDirty && busy === null` under a stable source ID and unregister on unmount.
Keep the visual unsaved indicator and Ctrl/Cmd+S code unchanged.

Successful save/delete calls already use programmatic `router.push`; ensure the
provider does not intercept them. If needed, expose a narrowly named
`allowNextNavigation()` function and call it only immediately after a confirmed
successful response, never before the fetch.

**Verify**: focused unit tests, lint, and build pass.

### Step 4: Browser acceptance check

Using seeded local data, verify at desktop and mobile widths:

1. edit a field, click a sidebar link -> localized confirm opens;
2. Cancel -> content remains and URL does not change;
3. Discard -> destination loads once;
4. Ctrl/Cmd+S -> save runs without the discard prompt;
5. successful Save/Publish/Delete -> normal redirect without prompt;
6. unmodified editor -> links navigate immediately;
7. English LTR and Arabic RTL dialog/button order are coherent.

Use a disposable DB:

`$env:DB_PATH="$env:TEMP\ecb-admin-nav.sqlite"; npm run seed:dev`

Then start `npm run web:dev`. Record any visual defect before marking done.

## Test plan

- Pure helper covers normal, modified, external, download, target, and hash links.
- Provider state supports two dirty sources and only clears the correct source.
- No prompt when clean or while a successful save is navigating.
- Manual/browser acceptance covers the actual capture-phase interaction because
  the repo intentionally has no DOM unit-test harness.

## Done criteria

- [ ] A dirty news draft cannot be lost through an admin Next Link without confirmation.
- [ ] Hard navigation warning remains active.
- [ ] Save/delete redirects and Ctrl/Cmd+S remain prompt-free.
- [ ] Dialog is localized and RTL-correct.
- [ ] No Next.js internal API or history monkey patch is used.
- [ ] All required repo checks pass.
- [ ] Plan 074 is marked DONE.

## STOP conditions

- Next's event handling prevents a standards-based capture listener from
  reliably cancelling links; report the observed browser behavior.
- The implementation requires intercepting browser back/forward to satisfy the
  stated same-origin anchor scope.
- A save path can navigate before the server confirms success.
- A new DOM test dependency appears necessary; report before adding it.

## Maintenance notes

Plan 076 should preserve this provider when replacing navigation with shadcn
Sidebar. New admin editors can opt in by registering their own stable dirty
source; do not duplicate click listeners per editor.

