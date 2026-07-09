# Plan 075: Redesign MCP key creation around purpose, least privilege, and setup success

> **Executor instructions**: Use the repo's Base UI shadcn components and RTL
> conventions. Do not hand-roll another chip/button control or broaden a key's
> default permissions. Run every verification and update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 5091ff1..HEAD -- apps/web/components.json apps/web/src/components/admin/mcp-key-manager.tsx apps/web/src/app/admin/mcp/page.tsx apps/web/src/app/api/admin/mcp-keys/route.ts apps/web/src/lib/admin-copy.ts apps/web/src/lib/mcp-tool-manifest.ts`

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans 069 and 073
- **Category**: direction
- **Planned at**: commit `5091ff1`, 2026-07-09

## Why this matters

The current form preselects every tool, game, and media scope, so the fastest
path creates the broadest possible credential. Long raw chip lists are hard to
scan, do not expose pressed state accessibly, and do not explain the public
tools that are always available. A purpose-first flow should start read-only,
make write access explicit, support searchable scope selection, and guide the
admin from one-time secret to a working client configuration.

## Current state

- `mcp-key-manager.tsx:91-153` implements custom chip buttons without
  `aria-pressed`, a fieldset, or search.
- Lines 201-203 initialize all tools, games, and media as selected; lines
  245-247 restore the same maximum-access state after creation.
- Lines 316-378 render labels without `htmlFor`/input IDs and display owner
  identity as disabled form inputs.
- Existing key cards show raw timestamps and have no empty state.
- The app uses shadcn `base-nova`, `@base-ui/react`, Lucide, Tailwind v4, RSC,
  and RTL (`apps/web/components.json`). Base UI composition uses `render`, not
  Radix `asChild`; link-backed buttons require `nativeButton={false}`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Inspect shadcn project | `cd apps/web; npx shadcn@latest info --json` | reports `base-nova`, RTL, Base UI |
| Add missing components | `cd apps/web; npx shadcn@latest add command checkbox empty` | exit 0; no existing customized file overwritten |
| Selection tests | `npm --workspace @esports-community-bot/web run test -- src/test/mcp-key-selection.test.ts src/test/mcp-key-admin-api.test.ts` | all pass |
| Bot tests | `npm test` | exit 0 |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

## Suggested executor toolkit

- Invoke the `shadcn` skill and read the Base UI docs for Field, Toggle Group,
  Command, Popover, Checkbox, Calendar, Empty, and Dialog before editing.
- Use browser automation for 390x844, 768x1024, and 1440x900 acceptance views.

## Scope

**In scope**:

- `apps/web/src/components/admin/mcp-key-manager.tsx`
- `apps/web/src/components/admin/mcp-scope-picker.tsx` (new)
- `apps/web/src/lib/mcp-key-selection.ts` (new pure model)
- `apps/web/src/app/admin/mcp/page.tsx`
- `apps/web/src/app/api/admin/mcp-keys/route.ts`
- `apps/web/src/lib/admin-copy.ts`
- `apps/web/src/lib/mcp-tool-manifest.ts`
- `apps/web/src/components/ui/command.tsx` (generated if absent)
- `apps/web/src/components/ui/checkbox.tsx` (generated if absent)
- `apps/web/src/components/ui/empty.tsx` (generated if absent)
- `apps/web/src/test/mcp-key-selection.test.ts` (new)
- `apps/web/src/test/mcp-key-admin-api.test.ts`
- `package-lock.json` only if the shadcn CLI legitimately changes dependencies

**Out of scope**:

- Changing bearer-key format or server authorization.
- Letting an admin issue a key for another owner.
- Persisting the one-time secret in browser storage or DB plaintext.
- Adding publish/delete/moderation write tools.
- The global admin shell/sidebar redesign (plan 076).

## Git workflow

- Branch: `codex/075-redesign-mcp-key-workflow`
- Commit example: `Improve MCP key setup experience`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Model key purposes and validation as pure data

Create `mcp-key-selection.ts` using manifest names, not duplicated literals.
Define these modes:

- **Research** (default): selectable admin read tools only; no write tools.
- **News drafting**: relevant reads plus `create_news_draft`.
- **Stream management**: relevant reads plus `update_stream_channel`.
- **Custom**: preserves manual choices.

Public/admin-always tools are never stored as selections. Default game and
media scopes are empty. Validation rules:

- at least one selectable tool;
- news drafting needs at least one selected game or media scope;
- stream management needs at least one selected game scope;
- expiry, when present, must be future;
- write modes must not silently select every available scope.

Export reducer-like functions for mode changes, toggles, select visible, clear,
and validation. Keep this file free of React for node Vitest.

**Verify**: selection tests cover every preset and least-privilege default.

### Step 2: Install and use the correct shadcn controls

Run the shadcn add command from `apps/web`. Inspect the diff before continuing;
do not overwrite customized Button, Field, Popover, Calendar, Dialog, or
ToggleGroup components.

Replace the custom `Chips` control:

- Purpose uses the installed Base UI `ToggleGroup` as a short segmented choice.
- Selectable tools use `FieldSet`/`FieldLegend` with Checkbox rows showing
  localized title, description, read/write badge, and the literal tool name in
  monospace secondary text.
- Games and media use a reusable searchable multi-select built from Command +
  Popover. Show search, selected count, select filtered results, clear, and an
  Empty result. Selected items may render as removable badges with icon-only X
  buttons and accessible labels.

Every form control needs a stable `id`, `htmlFor`, description association, and
visible focus state. Do not render text buttons where a familiar icon action is
enough; use Lucide icons and tooltips for unfamiliar icon-only actions.

**Verify**: web lint and build pass.

### Step 3: Clarify fixed access and owner identity

Show an uneditable identity summary (user icon, owner display name, Discord ID
in LTR monospace) in a muted section rather than disabled form fields. It should
look intentionally read-only, not like broken inputs.

Add an "Always available" section sourced from manifest entries such as public
reads and `get_admin_capabilities`. These entries are visually muted/fixed and
cannot be toggled. Add concise copy explaining that game/media selections only
narrow the signed-in admin's existing permissions.

The POST payload must contain only selectable tools and explicitly selected
scopes. Preserve the server's owner-from-session enforcement.

**Verify**: MCP key API tests prove spoofed owner fields are ignored and only
allowed selectable names/scopes are stored.

### Step 4: Improve expiry and submission feedback

Keep shadcn Calendar + time input, but give both controls IDs/labels and locale
formatting. Offer explicit presets (for example 30 days and 90 days) only if
they can be represented with familiar buttons without hiding the exact date.
"No expiry" remains available but is not visually recommended over expiring
keys.

Show a compact permission summary before Create: purpose, number of selected
tools, games, media, and expiry. Disable submission with an inline FieldError
that explains the first unmet requirement. Avoid toast-only error handling;
retain the visible Alert.

**Verify**: pure validation tests and web build pass.

### Step 5: Turn the one-time secret into a short setup flow

After creation, show a controlled Dialog or prominent Alert that remains in
memory only. Include:

1. Copy key.
2. Copy MCP endpoint URL.
3. Client setup snippets for Codex and Claude that reference an environment
   variable rather than embedding the secret in a committed config file.
4. Open the localized `/docs/admin-mcp` guide.
5. A clear acknowledgement that closing the panel loses the plaintext.

Do not write the secret to `localStorage`, session storage, URL parameters,
analytics, console, or audit details. Reset the form to Research with empty
scopes, not maximum access.

**Verify**: search the component diff for `localStorage`, `sessionStorage`, and
`console.log`; none may contain secret handling.

### Step 6: Make existing-key management scannable

Render keys as a flat list of individual cards (no card inside card) with:

- label and prefix;
- Active, Expired, or Revoked status;
- localized created, last-used, and expiry dates;
- purpose/tool summary and selected-scope counts;
- expanded details on demand rather than dozens of badges by default;
- revoke icon with tooltip and existing ConfirmDialog.

Use the shadcn Empty component when there are no keys. Keep super-admin
visibility of all owners but clearly separate owner identity.

**Verify**: build succeeds and no long tool/scope list overflows at mobile width.

### Step 7: Visual and keyboard acceptance

With seeded data and both locales, verify:

- full keyboard operation and visible focus for purpose, search, checkboxes,
  date, create, copy, and revoke;
- screen-reader state is exposed for selected options;
- Arabic uses RTL while Discord IDs, tool names, and URLs stay LTR;
- no horizontal page scroll at 390px;
- long game/media lists are searchable rather than page-length chip walls;
- default state contains no write tool and no scope;
- one-time secret panel is usable but never persists after refresh.

## Test plan

- Pure preset/reducer tests for every mode and transition to Custom.
- Default selection is read-only with empty scopes.
- Write-mode validation requires the appropriate scope kind.
- API still intersects requested scopes with owner permissions.
- API rejects non-manifest tools and zero selectable tools.
- Existing key status derives Expired correctly from `expiresAt`.
- Visual acceptance covers LTR/RTL and mobile/desktop.

## Done criteria

- [ ] Maximum access is no longer the default or reset state.
- [ ] All selection controls use accessible Base UI shadcn primitives.
- [ ] Game/media choices are searchable and show selected counts.
- [ ] Always-on tools are clearly fixed and not misleading toggles.
- [ ] Owner identity is read-only by design, not editable/disabled form input.
- [ ] Plaintext secret is memory-only and accompanied by client setup actions.
- [ ] Existing keys have localized status/timestamps and an empty state.
- [ ] All required repo checks pass.
- [ ] Plan 075 is marked DONE.

## STOP conditions

- Plan 069's manifest does not expose always-on versus selectable tools.
- Plan 073's capability tool is absent or has different grant semantics.
- The shadcn CLI proposes overwriting customized primitives; stop and report
  the files instead of accepting overwrite.
- A requested UX change would require storing the plaintext key.
- Base UI component APIs differ from the documented `render` composition; read
  the generated component and report before substituting Radix patterns.

## Maintenance notes

Add future key purposes to the pure selection model and manifest-derived tool
sets. Reviewers should verify least privilege, keyboard behavior, and secret
non-persistence before focusing on visual polish.

