# Plan 101: Redesign the login page as a first-class public-site surface

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Preparation and drift check (run first)**: In a clean isolated worktree,
> run `git fetch origin main`, create/switch to `codex/101-redesign-login-page`
> from the fetched `origin/main`, and confirm `git status --short` is empty.
> Then run:
> `git diff --stat fe7beec..HEAD -- apps/web/src/app/login/page.tsx apps/web/src/components/dashboard/login-panel.tsx apps/web/src/lib/i18n.ts apps/web/src/lib/login-navigation.ts apps/web/src/test/login-navigation.test.ts apps/web/src/test/login-panel.test.tsx apps/web/e2e/login.spec.ts`
> If an in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding. On a
> material mismatch, treat it as a STOP condition.

## Status

- **Result**: DONE - merged in PR #254 (`b272848`) and deployed to CranL on 2026-07-15
- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `fe7beec`, 2026-07-15

## Why this matters

The login route currently looks like an isolated shadcn example instead of part
of Esports Community. It adds a second brand mark below the global header,
forces a full viewport of muted background, and constrains the only useful
action to a small generic card. The redesign must feel native to the public
site on desktop and mobile while preserving the simple one-provider sign-in
flow, bilingual routing, legal copy, and failure feedback.

The route also forwards a query-provided `callbackURL` directly to Better Auth.
The visual work is the right boundary at which to normalize this return path so
the polished login flow cannot be used to leave the site or return an Arabic
visitor to an English route.

## Current state

- `apps/web/src/app/layout.tsx` renders `SiteHeader`, the page content, and
  `SiteFooter` for every public route. The login page must compose with that
  shell; it must not recreate the brand header.
- `apps/web/src/app/login/page.tsx:18-34` currently builds a second standalone
  shell:

  ```tsx
  <main className="flex min-h-svh flex-1 flex-col items-center justify-center gap-6 bg-muted px-6 py-10 md:px-10">
    <div className="flex w-full max-w-sm flex-col gap-6">
      <Link href={localizedPath("/", locale)} ...>
        <span className="... bg-primary ...">
          <TrophyIcon className="size-4" />
        </span>
        <span>{text.brand}</span>
      </Link>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <LoginPanel locale={locale} />
      </Suspense>
    </div>
  </main>
  ```

- `apps/web/src/components/dashboard/login-panel.tsx:51-92` renders a generic
  centered `Card`, a single button, an inline locale conditional for the trust
  separator, and the legal copy. The button is not full width and the card has
  no Esports Community identity beyond the duplicate page-level trophy.
- `apps/web/src/components/dashboard/login-panel.tsx:35-43` reads the callback
  directly from the query string and passes it to Better Auth:

  ```tsx
  const callbackURL = searchParams.get("callbackURL") || localizedPath("/me", locale);
  // ...
  await signIn.social({ provider: "discord", callbackURL });
  ```

- `apps/web/src/lib/profile-navigation.ts:18-29` is the local exemplar for
  rejecting unsafe internal return paths. Login needs a purpose-specific
  helper rather than importing a profile-only parser or duplicating ad hoc
  checks.
- `apps/web/src/lib/i18n.ts` owns all English and Arabic copy. The existing
  `login` object has `title`, `description`, failure/pending labels, and legal
  text. Add any new trust, browse, and metadata labels there in both locales;
  no visible string may remain in a `locale === "ar"` branch.
- `apps/web/components.json` configures shadcn `base-nova`, Base UI, lucide,
  semantic CSS variables, and RTL support. Existing UI components include
  `Card`, `Button`, `Alert`, `Field`, `Skeleton`, and `Separator`.
- `apps/web/playwright.config.ts` already covers desktop Chromium at 1440x900
  and mobile Chromium with iPhone 13. `npm run web:e2e` starts a disposable,
  seeded local app; tests must not contact Discord.
- The route's `robots: { index: false, follow: true }` policy is intentional
  and must remain.

## Target experience

1. Keep the global header and footer visible. The page content is one centered,
   responsive auth surface using the public site's `max-w-6xl`, `px-4 sm:px-8`,
   border, card, and semantic token conventions.
2. Remove the page-level duplicate brand link, `min-h-svh`, and solid
   `bg-muted`. The content area should flex to fill the space between header
   and footer, with balanced vertical padding rather than pretending to be a
   separate application.
3. Use one `Card` with standard `CardHeader`, `CardContent`, and `CardFooter`
   composition. Do not put another card inside it. The card should be roughly
   `max-w-lg`, remain full width on mobile, and not look stranded at 1440px.
4. Put the real local `/icon.svg` EC mark in the card header with a stable
   square size. Use natural `text-start` and logical spacing so icon, title,
   and description reverse correctly under RTL. Do not use `TrophyIcon` as the
   login brand.
5. Make the Discord action full width and visually primary. Preserve disabled
   pending behavior, add `aria-busy={pending}`, prevent duplicate submissions,
   and keep the localized pending label. Catch thrown sign-in failures as well
   as Better Auth error results so pending cannot remain stuck.
6. Keep the destructive `Alert` in document flow. Add a quiet localized trust
   line and a secondary full-width browse/home action that does not compete
   with sign-in. Put terms/privacy legal copy in the card footer with localized
   links.
7. Do not add gradients, decorative orbs, a marketing hero, raw colors,
   arbitrary CSS, or a new global theme. Do not describe the product with a
   feature checklist. This is an authentication task, not a landing page.
8. The Suspense fallback must occupy approximately the final card dimensions
   and the same width container so hydration does not visibly jump.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Bot regression | `npm test` | exit 0; all bot tests pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0; no lint errors |
| Web unit tests | `npm --workspace @esports-community-bot/web run test` | exit 0; all Vitest tests pass |
| Web build | `npm run web:build` | exit 0; Next build and TypeScript pass |
| Browser tests | `npm run web:e2e -- --grep "login"` | exit 0 in desktop and mobile projects |
| Full browser regression | `npm run web:e2e` | exit 0; all Playwright projects pass |

## Suggested executor toolkit

- Use the local `shadcn` skill if available. Before changing composition, run
  `npx shadcn@latest info --json` and
  `npx shadcn@latest docs card button alert field skeleton` from `apps/web`.
  Do not add or overwrite components: the required components are installed.
- Follow the existing Base UI `Button` API. Icons inside a button use
  `data-icon="inline-start"`; use semantic variants instead of color classes.
- Follow `apps/web/src/test/today-for-you-component.test.tsx` for bilingual
  `renderToStaticMarkup` tests and `apps/web/e2e/global-search.spec.ts` for
  EN/AR overflow and direction assertions.

## Scope

**In scope** (the only application files to modify):

- `apps/web/src/app/login/page.tsx`
- `apps/web/src/components/dashboard/login-panel.tsx`
- `apps/web/src/lib/i18n.ts`
- `apps/web/src/lib/login-navigation.ts` (create)
- `apps/web/src/test/login-navigation.test.ts` (create)
- `apps/web/src/test/login-panel.test.tsx` (create)
- `apps/web/e2e/login.spec.ts` (create)
- `plans/README.md` (status only)

**Out of scope** (do not touch):

- `apps/web/src/app/layout.tsx`, `site-header*`, and `site-footer.tsx`
- `apps/web/src/app/globals.css` or theme token values
- Better Auth server/client provider configuration and Discord OAuth scopes
- session, admin authorization, or account/profile behavior
- crawler policy beyond preserving login's current noindex/follow metadata
- new images, remote assets, new dependencies, or shadcn component rewrites
- unrelated public pages or admin login behavior

## Git workflow

- Run `git fetch origin main`, then start from the fetched `origin/main`, not
  the dirty checkout in which this plan was authored. Run the drift command
  only after that fetch so it compares against the actual delivery baseline.
- Branch: `codex/101-redesign-login-page`.
- Make one or two logical commits using the observed style, for example
  `feat(web): redesign login experience` and, only if useful,
  `test(web): cover login routing and responsive layout`.
- The operator explicitly requested delivery: after review and all gates pass,
  push the branch, open a ready PR, wait for required CI, merge to `main`, and
  deploy the merged commit through the existing CranL production workflow.
- Never commit credentials, generated screenshots, Playwright traces, local
  databases, or unrelated dirty files.

## Steps

### Step 1: Add a fail-closed localized callback helper

Create `apps/web/src/lib/login-navigation.ts` with one exported pure function,
for example `loginCallbackUrl(value, locale)`. It must:

- return `localizedPath("/me", locale)` for missing, empty, overlong, malformed,
  absolute, protocol-relative, backslash-containing, control-character, `/api`,
  or `/login` input;
- accept only a same-site relative path beginning with exactly one `/`;
- parse against a fixed dummy origin and confirm the result remains on that
  origin rather than relying only on string prefixes;
- validate both the raw path and a bounded decoded/canonical path. Reject
  malformed percent escapes, encoded path separators/backslashes/controls,
  and any decoded path that reaches a blocked route. Let the URL parser resolve
  dot segments before applying blocked-route checks;
- block only the exact `/api` and `/login` route segments and their descendants
  after locale stripping; `/apiculture` and `/login-help` remain valid;
- strip an existing locale prefix, then reapply the current login locale with
  `localizedPath`, so `/me` becomes `/ar/me` for Arabic and `/ar/me` becomes
  `/me` for English;
- preserve the valid query string and hash;
- have no access to `window`, request headers, sessions, or environment values.

Create `apps/web/src/test/login-navigation.test.ts`. Cover at least:

- fallback in English and Arabic;
- valid `/me`, `/admin/news/new`, query, and hash paths;
- locale normalization in both directions;
- rejection of `https://...`, `//...`, backslashes, CR/LF, `/api`, `/login`,
  whitespace-only input, and an input beyond the helper's explicit cap;
- dot-segment paths that resolve into `/api` or `/login`, encoded route names,
  encoded slashes/backslashes/controls, malformed percent escapes, and safe
  segment-boundary controls such as `/apiculture` and `/login-help`.

**Verify**:
`npm --workspace @esports-community-bot/web run test -- login-navigation.test.ts`
must exit 0 with every named case passing.

### Step 2: Redesign the page shell without duplicating global navigation

Update `apps/web/src/app/login/page.tsx`:

- remove `Link`, `TrophyIcon`, and the duplicate brand block;
- retain a single page-level `<main>` and the existing noindex/follow policy;
- use a flex-filling content band with the same `max-w-6xl` and responsive
  horizontal padding as other public pages;
- center a `w-full max-w-lg` panel with balanced `py-10 sm:py-14` or equivalent;
- keep Suspense, but make its `Skeleton` match the final card's width and
  approximate height;
- provide locale-aware `generateMetadata` with the localized login title and
  return `robots: { index: false, follow: true }` exactly. The crawler policy
  is mandatory, not conditional.

Do not edit the root layout to hide the header or footer. Do not create a
login-only background.

**Verify**:
`npm --workspace @esports-community-bot/web run lint -- src/app/login/page.tsx`
must exit 0.

### Step 3: Compose the polished shadcn auth card and states

Refactor `apps/web/src/components/dashboard/login-panel.tsx` while preserving
the `LoginPanel({ locale })` public API:

- call the Step 1 helper for `callbackURL`;
- separate a small exported presentational view from the search-param/state
  wrapper only if needed for deterministic static rendering tests; do not build
  a generic auth framework;
- use complete `CardHeader`, `CardContent`, and `CardFooter` composition;
- render `/icon.svg` with a stable width/height using `next/image`, an empty alt
  if adjacent text already names the site, and no remote URL;
- align the header with logical direction (`text-start`, logical margins) so
  Arabic naturally mirrors without hand-coded physical left/right classes;
- render the Discord `Button` at `size="lg"`, `className="w-full"`, with the
  existing `DiscordIcon`, `disabled={pending}`, and `aria-busy={pending}`;
- guard against duplicate clicks and handle thrown/rejected sign-in attempts;
- retain the `Alert` for errors and ensure it has localized title/description;
- replace the inline `locale === "ar"` separator string with i18n-backed copy;
- add a low-emphasis secondary action back to `localizedPath("/", locale)`.
  With Base UI, compose navigation as
  `Button render={<Link href={...} />} nativeButton={false}` or use a plain
  `Link`; never nest an anchor inside a button. Give its directional arrow
  `data-icon` and `rtl:rotate-180`;
- keep legal links in the footer and give them visible hover/focus treatment.

Update both `copy.en.login` and `copy.ar.login` in
`apps/web/src/lib/i18n.ts`. Include every new visible label and, if retained,
the trust line. The English and Arabic object keys must remain structurally
identical.

**Verify**:

1. `npm --workspace @esports-community-bot/web run lint -- src/components/dashboard/login-panel.tsx src/lib/i18n.ts`
   exits 0.
2. `git grep -n 'locale === "ar"' -- apps/web/src/components/dashboard/login-panel.tsx`
   returns no matches.
3. `git grep -n 'TrophyIcon' -- apps/web/src/app/login/page.tsx apps/web/src/components/dashboard/login-panel.tsx`
   returns no matches.

### Step 4: Lock the bilingual states with unit tests

Create `apps/web/src/test/login-panel.test.tsx` using
`renderToStaticMarkup`. Test the presentational view, not Next navigation or a
real OAuth request. Assert:

- English and Arabic headings/descriptions render;
- English links use `/terms`, `/privacy`, and `/`, while Arabic links use
  `/ar/terms`, `/ar/privacy`, and `/ar`;
- `/icon.svg` and the Discord label render;
- pending output is disabled and exposes `aria-busy="true"`;
- destructive error output renders the localized failure title;
- the secondary action renders as an anchor and its arrow has RTL mirroring;
- the removed duplicate page brand structure and old hard-coded separator are
  not reintroduced.

**Verify**:
`npm --workspace @esports-community-bot/web run test -- login-panel.test.tsx login-navigation.test.ts`
must exit 0.

### Step 5: Add responsive EN/AR browser coverage

Create `apps/web/e2e/login.spec.ts` using the existing fixtures. Cover both
Playwright projects and both locales:

- `/login` has `html[dir="ltr"]`; `/ar/login` has `html[dir="rtl"]`;
- the global header and footer remain visible and the old extra brand link is
  absent from `main`;
- the login card, Discord action, secondary browse action, and legal links are
  visible and reachable by role;
- document width never exceeds viewport width;
- primary button remains within the viewport at 390x844 and desktop content is
  centered rather than a tiny top-aligned panel;
- valid `callbackURL` initiation sends the normalized internal path. Intercept
  the local Better Auth social-sign-in request and inspect its request body;
  fulfill it locally. Never allow the test to contact discord.com;
- unsafe callback input falls back to the localized `/me` path.
- a delayed intercepted response receives only one request after a rapid
  double click and leaves the primary action disabled while pending;
- an error result and an aborted/rejected request both render the localized
  failure alert and re-enable the primary action. Static markup tests are not
  a substitute for these state-transition checks.

If Better Auth's generated request path or body differs from the expected local
endpoint, inspect the browser request once and adapt the test to the actual
installed Better Auth client. Do not change auth configuration to satisfy the
test.

**Verify**:
`npm run web:e2e -- --grep "login"` exits 0 in desktop and mobile Chromium.

### Step 6: Perform visual QA before shipping

Run the seeded local app and inspect `/login` and `/ar/login` at:

- 390x844 mobile;
- 768x1024 tablet;
- 1440x900 desktop;
- light and dark themes for every size;
- default, pending, and error states where practical.

Confirm there is no duplicate brand strip, horizontal scroll, clipped Arabic,
overlap with the sticky header, excessive empty top space, nested card, or
layout jump when Suspense resolves. The card should remain the single visual
focus while still reading as part of the existing public site.

Store no QA screenshots in the repository.

**Verify**:
`npm run web:e2e` exits 0 after the visual pass.

### Step 7: Run the full gate, review, merge, and deploy

Run, in order:

1. `npm test`
2. `npm --workspace @esports-community-bot/web run lint`
3. `npm --workspace @esports-community-bot/web run test`
4. `npm run web:build`
5. `npm run web:e2e`

Review `git diff --check`, `git status --short`, and
`git diff --name-only origin/main...HEAD`. Only in-scope files may appear.
Record the pre-merge `origin/main` SHA as the rollback revision. Push the
branch, open a ready PR, and wait for all required GitHub checks. Merge only the
reviewed green commit, then update the Plan 101 row on the delivery branch or a
follow-up docs commit with the PR and merged SHA.

Deploy the merged `main` commit by calling the existing CranL app
`fc370266-a206-4d29-acb2-434bbae3b0f2` deployment trigger. Do not change
environment variables for this UI-only change. Poll CranL deployment history
until the new deployment reports `done`; if it reports `error`, inspect that
deployment's build log and stop. Once `done`, confirm the app status is running
and inspect a bounded tail of runtime logs for startup/auth errors before
verifying:

- `https://esportscommunity.net/login` returns 200 and has `lang="en"`,
  `dir="ltr"`, noindex, the global shell, and the redesigned card;
- `https://esportscommunity.net/ar/login` returns 200 and has `lang="ar"`,
  `dir="rtl"`, localized links, no overflow, and the redesigned card;
- a safe callback such as `/me?tab=predictions` is retained and an external
  callback is replaced by `/me` before the OAuth request;
- homepage and one signed-in profile/admin route still load normally.

If production health or the login checks fail, stop further rollout, preserve
the failed deployment logs, revert the merge on `main` back to the recorded
pre-merge revision, trigger a fresh CranL deployment, and repeat the health and
route checks. Do not attempt an environment change as a UI rollback.

Do not paste OAuth credentials, session cookies, or CranL secrets into logs or
the PR.

## Test plan

- `apps/web/src/test/login-navigation.test.ts`: pure callback normalization,
  locale preservation, fallback, and malicious-input matrix.
- `apps/web/src/test/login-panel.test.tsx`: static EN/AR rendering, pending,
  error, legal links, real brand asset, and secondary browse action.
- `apps/web/e2e/login.spec.ts`: desktop/mobile public-shell composition,
  direction, overflow, visible controls, and intercepted OAuth initiation.
- Existing web suite: confirms i18n shape, auth/admin routing, public shell, and
  all unrelated pages remain intact.
- Full bot suite: confirms the shared workspace has no unrelated regression.

## Done criteria

- [ ] Login uses the global header/footer without a duplicate page brand block.
- [ ] The card uses `/icon.svg`, complete shadcn Card composition, semantic
      tokens, and a full-width Discord action.
- [ ] EN and AR copy, links, alignment, and direction are correct.
- [ ] Pending, thrown-error, and Better Auth error-result states are bounded and
      accessible.
- [ ] Callback URLs are fail-closed, internal-only, and normalized to locale;
      unit tests cover malicious inputs.
- [ ] Login remains `noindex, follow`.
- [ ] No horizontal overflow or overlap at 390x844, 768x1024, or 1440x900 in
      light/dark EN/AR.
- [ ] `npm test`, web lint, web tests, web build, and full web E2E all exit 0.
- [ ] `git diff --check` exits 0 and only in-scope files changed.
- [ ] Ready PR is reviewed, required CI is green, and the PR is merged.
- [ ] CranL deploy is healthy and production `/login` plus `/ar/login` checks
      pass.
- [ ] `plans/README.md` marks Plan 101 DONE with the merged commit/PR.

## STOP conditions

Stop and report instead of improvising if:

- an in-scope file materially differs from the current-state excerpts because
  another branch changed the auth flow;
- the redesign requires hiding or modifying the global header/footer;
- safe callbacks require changing Better Auth provider configuration;
- a test would need a real Discord OAuth request, production cookie, or secret;
- localized routing cannot preserve query/hash with the existing i18n helper;
- required shadcn components are missing and adding/updating generated
  components would modify files outside scope;
- the CranL deployment target is not building the merged `main` commit;
- a verification command fails twice after one reasonable correction.

## Maintenance notes

- Keep callback normalization in `login-navigation.ts`; future OAuth providers
  should reuse it rather than reading `callbackURL` directly.
- If the root public shell changes height or padding, re-run login at the three
  required viewports because this page intentionally fills the remaining shell
  space instead of owning `min-h-svh`.
- Reviewers should scrutinize callback parsing, Arabic locale normalization,
  focus order, and pending reset behavior more than decorative details.
- Adding email/password, account linking, or multiple OAuth providers is
  explicitly deferred. Those would require a new product/auth plan rather than
  stretching this one-provider card.
