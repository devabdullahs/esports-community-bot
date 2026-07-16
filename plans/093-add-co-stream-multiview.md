# Plan 093: Add a safe, responsive 1-9 stream multiview

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the STOP conditions occurs, stop and report; do
> not improvise. When done, update this plan's status row in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Baseline and drift check (run first)**: this plan was written against the
> `origin/main` merge commit `87d207f`. The operator's currently checked-out
> worktree may be on an older feature branch, so do not infer the baseline from
> local branch names. Run `git fetch origin main`, then
> `git merge-base --is-ancestor 87d207f origin/main`. It must exit 0. Next run:
> `git diff --stat 87d207f..origin/main -- apps/web/src/app/co-streams/page.tsx apps/web/src/components/streams/co-streams-view.tsx apps/web/src/components/streams/stream-embed.tsx apps/web/src/lib/co-streams.ts apps/web/src/app/privacy/page.tsx scripts/seed-dev.mjs`
> Create the implementation branch from fetched `origin/main`, not from the
> operator's stale local branch. If an in-scope file changed, compare the
> Current state excerpts with live `origin/main`; if the contracts no longer
> match, stop and report instead of applying this plan mechanically.

## Status

- **Priority**: P1
- **Effort**: L (multi-day frontend feature plus responsive QA)
- **Risk**: MED (up to nine third-party players can amplify bandwidth, autoplay,
  and mobile-layout problems)
- **Depends on**: Plan 057 (DONE; creator grouping and platform icons already
  exist)
- **Category**: direction / feature
- **Planned at**: commit `87d207f`, 2026-07-12

## Why this matters

The co-stream page currently chooses exactly one creator and renders one iframe.
During EWC events, viewers often want to follow several language feeds or games
without opening many browser tabs. This plan turns the existing player into a
user-controlled multiview for one through nine distinct creator groups, while
keeping the current admin-selected platform default, live-status polling,
Twitch parent validation, CSP restrictions, and bilingual behavior.

The design intentionally loads no more than nine players, starts third-party
players only after the page/default selection or an explicit add action, and
does not attempt cross-origin audio control. Twitch and Kick support explicit
autoplay and mute parameters. YouTube documents autoplay and inline playback,
but not a URL mute parameter; its multiview tile must therefore be user-started
instead of relying on an undocumented query option.

## Current state

- `apps/web/src/components/streams/co-streams-view.tsx` is the whole client
  experience. Lines 78-82 store one `selectedId`; lines 125-129 resolve one
  selected live group or fall back to the first live group; lines 145-152 render
  one `StreamEmbed`. Lines 236-307 render the filterable creator cards.
- `apps/web/src/components/streams/stream-embed.tsx` lines 8-18 construct only
  allowlisted provider URLs from a typed platform, encoded handle, validated
  Twitch parent, and YouTube video ID. Preserve this boundary: URL query state
  must never become an iframe URL directly.
- `apps/web/src/lib/co-streams.ts` lines 53-60 choose one group's embed channel:
  live default, then another live embeddable channel, then offline fallbacks.
  Multiview selects creator groups, not individual platform rows, so the admin's
  default still decides which platform is embedded.
- `apps/web/src/app/co-streams/page.tsx` validates the Twitch `parent` hostname
  and passes server-fetched groups into `CoStreamsView`. It does not currently
  accept shareable selection state.
- `apps/web/src/app/api/co-streams/route.ts` returns all grouped streams and is
  backed by a 30-second server cache. The client polls it every 60 seconds. No
  extra API endpoint or database query is needed for multiview.
- `apps/web/next.config.ts` already restricts `frame-src` to Twitch, Kick, and
  YouTube hosts. Do not broaden it.
- `apps/web/src/test/co-streams.test.ts` characterizes grouping, default-platform
  selection, viewer aggregation, ordering, and YouTube embeddability. It has no
  tests for multiview state, URL parsing, grid counts, or embed parameters.
- `apps/web/src/app/privacy/page.tsx` lines 114-119 and 234-239 list third-party
  processors but omit Twitch, Kick, and YouTube embeds. Correct that disclosure
  as part of loading more than one external player.
- The web app is Next.js 16 / React 19 / Tailwind 4 with shadcn `base-nova`,
  Base UI primitives, Lucide icons, RTL enabled, and the `@/` alias. Installed
  components already include `Sheet`, `Command`, `Badge`, `Button`, and
  `Tooltip`; add no UI package.

## External constraints and references

- Twitch requires the `parent` parameter and documents `autoplay` and `muted`;
  preserve the existing trusted-parent flow:
  https://dev.twitch.tv/docs/embed/video-and-clips/
- Kick documents `autoplay=true|false` and `muted=true|false` URL parameters:
  https://help.kick.com/en/articles/8010826-how-to-embed-your-kick-livestream
- YouTube documents `autoplay`, `playsinline`, and a minimum 200x200 viewport,
  but no iframe URL mute parameter:
  https://developers.google.com/youtube/player_parameters
- Audible autoplay is commonly blocked and is disruptive; selected Twitch/Kick
  tiles should start muted, and YouTube should wait for user playback:
  https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay
- Fullscreen requests must originate from a user event and can fail; feature
  detect and handle rejection:
  https://developer.mozilla.org/en-US/docs/Web/API/Fullscreen_API/Guide
- Compose the installed shadcn components according to their Base UI APIs:
  https://ui.shadcn.com/docs/components/base/sheet
  https://ui.shadcn.com/docs/components/base/command
  https://ui.shadcn.com/docs/components/base/tooltip

The skills search found no well-adopted skill specifically for browser
multistream UX. Do not install any of the low-adoption generic streaming skills;
use the repository's installed shadcn skill/components and the provider docs.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Bot baseline | `npm test` | all bot tests pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all web tests pass |
| Web build | `npm run web:build` | exit 0 |
| Disposable visual data (PowerShell) | `$env:DB_PATH="$env:TEMP\ecb-multiview.sqlite"; npm run seed:dev` | seed exits 0 and prints co-stream fixture count |
| Local web (same shell/env) | `npm run web:dev` | Next dev server starts; use its printed URL |

No dependency install or lockfile change should be required.

## Suggested executor toolkit

- Invoke the local `shadcn` skill before editing the picker. Re-run
  `npx shadcn@latest info --json` and `npx shadcn@latest docs sheet command tooltip button badge`;
  use the Base UI `render` API, not Radix `asChild` examples.
- Use browser automation or the available Chrome tooling for the viewport/RTL
  matrix in Step 8. Screenshots are temporary QA artifacts and must not be
  committed.

## Scope

**In scope (only these source/test files):**

- `apps/web/src/app/co-streams/page.tsx`
- `apps/web/src/components/streams/co-streams-view.tsx`
- `apps/web/src/components/streams/stream-embed.tsx`
- `apps/web/src/components/streams/multi-stream-grid.tsx` (create)
- `apps/web/src/lib/co-stream-multiview.ts` (create)
- `apps/web/src/test/co-stream-multiview.test.tsx` (create; JSX is appropriate
  for the component render cases and the existing Vitest transform supports it;
  add no JSX plugin or test dependency)
- `apps/web/src/test/stream-embed.test.ts` (create)
- `apps/web/src/app/privacy/page.tsx`
- `scripts/seed-dev.mjs`
- `plans/README.md` (status only)

**Out of scope (do not touch):**

- `apps/web/src/app/api/co-streams/route.ts`, `apps/web/src/lib/co-streams.ts`,
  `src/db/streamChannels.js`, and all schema/migration files. The existing data
  contract is sufficient.
- Admin co-stream management and creator/default-platform rules.
- Per-match co-stream strips, homepage live strip, nav badge, Discord alerts,
  public/admin MCP tools, and stream polling services.
- Chat embeds, coordinated cross-platform volume, drag-and-drop reordering,
  picture-in-picture orchestration, or a provider SDK. These are separate future
  features, not reasons to enlarge this implementation.
- New npm dependencies or changes to the CSP allowlist.

## Git workflow

- After the baseline check, create `codex/093-co-stream-multiview` from fetched
  `origin/main` (for example, in a clean worktree with
  `git switch -c codex/093-co-stream-multiview origin/main`). Do not base it on
  whichever older feature branch happens to be checked out in the operator's
  main workspace.
- Use conventional commits matching recent history, for example
  `feat(streams): add co-stream multiview`.
- Do not push or open a PR unless the operator explicitly asks.

## Product decisions (implement as written)

1. A selection is a `CoStream` creator group, not one platform row. This avoids
   loading the same creator on Twitch, Kick, and YouTube at once and respects the
   admin-selected default/fallback logic already in `pickEmbedChannel`.
2. Maximum selection and iframe count is exactly 9. The cap is enforced in pure
   state helpers and defensively again in the grid renderer.
3. With no `stream` query parameters, preserve today's behavior by selecting the
   first live embeddable group. Repeated `stream=<group-id>` parameters represent
   a shared view. Invalid/stale values are ignored, deduplicated, length-bounded,
   and never converted into provider URLs.
4. Poll updates preserve selection order. A selected stream going offline stays
   in place with an offline state and remove action; do not silently replace it.
   A group removed entirely from the API is pruned.
5. The layout is automatic. Mobile uses one column; normal desktop uses two;
   three columns are enabled only on very wide viewports (about 1800px) so tiles
   remain useful. Counts 1-9 never cause horizontal scrolling.
6. Selected Twitch and Kick players use explicit autoplay plus muted startup.
   YouTube uses `autoplay=0&playsinline=1`; the viewer starts playback inside
   that provider player. Do not add undocumented `mute=1` or provider SDKs.
   On initial page load, mount an iframe only for the first selected tile; every
   additional tile restored from repeated `stream=` parameters is a lightweight
   `Load stream` poster in a fixed aspect-video slot. A stream the viewer
   explicitly adds during the current session loads immediately from that same
   add action, avoiding a needless second click. A restored poster loads only
   when its `Load stream` button is pressed. Do not add `Play all` in v1: it is
   ambiguous for YouTube (whose iframe remains user-started) and defeats the
   shared-link bandwidth safeguard. The URL stores selection, not loaded state.
7. The whole grid has one feature-detected fullscreen button. Individual players
   retain their provider fullscreen controls.
8. The selection is shareable through the current URL. Do not use localStorage
   or create server-side saved layouts in v1.

## Steps

### Step 1: Add a pure, bounded multiview state model

Create `apps/web/src/lib/co-stream-multiview.ts` with no `server-only` or browser
imports so both the server page and client component can use it.

Export:

- `MAX_MULTI_STREAMS = 9`.
- `sanitizeRequestedStreamIds(value: string | string[] | undefined): string[]`:
  flatten repeated values, trim, reject empty/control-character values, cap each
  ID at 240 characters, preserve order, deduplicate, and slice to 9.
- `initialSelectedStreamIds(requested, streams, hasExplicitSelection)`:
  intersect requested IDs with existing groups. If there was no explicit query,
  return the first `isLive && embedChannel` group; if a shared query is explicit
  but stale, return only survivors (possibly empty), not an unrelated fallback.
- `reconcileSelectedStreamIds(selected, streams)`: preserve order, remove only
  groups that disappeared entirely, dedupe, and cap at 9. Do not remove a group
  merely because it went offline or lost a YouTube video ID.
- `initialLoadedStreamIds(selected, streams)`: return at most the first selected
  ID whose latest group is live and embeddable. This enforces one iframe on a
  fresh/shared initial render without conflating selection with loading.
- `reconcileLoadedStreamIds(loaded, selected)`: preserve loaded order, retain
  only selected IDs, dedupe, and cap at 9. Offline status alone must not remove
  a loaded ID.
- `toggleSelectedStreamId(selected, id, selectableIds)`: remove an existing ID;
  otherwise add only if `id` is in the live/embeddable selectable set and the
  selection is below 9. Return `{ ids, limitReached }` so UI feedback is testable.
- `streamSelectionSearchParams(ids)`: produce repeated `["stream", id]` pairs
  after the same sanitation. Do not concatenate with commas.
- `multiviewGridClass(count)`: return complete static Tailwind class strings for
  counts 0-9. Use one column by default, two at `xl` for 2+ streams, and three at
  `min-[112rem]` for 3+ streams. Keep all possible class strings literal in this
  function so Tailwind can discover them.

Write the first half of `apps/web/src/test/co-stream-multiview.test.tsx` now.
Cover: duplicate/blank/control/overlong query IDs, 10 IDs capped to 9, explicit
stale query does not fall back, no-query selects first live embeddable, offline
selection survives reconciliation, removed group is pruned, initial loaded
state contains at most one eligible selected ID, loaded state remains a subset
of selection, duplicate add is idempotent, 10th add reports `limitReached`, and
grid class results for every count from 0 through 9.

**Verify**:
`npm --workspace @esports-community-bot/web run test -- co-stream-multiview.test.tsx`
passes all new state tests.

### Step 2: Parse bounded share state at the server page boundary

Update `apps/web/src/app/co-streams/page.tsx` so the page accepts Next App Router
`searchParams` as a Promise. Read repeated `stream` values, call
`sanitizeRequestedStreamIds`, and pass both `requestedStreamIds` and
`hasExplicitSelection` to `CoStreamsView`.

Do not change `parentHost`, metadata, caching, or server stream retrieval. The
server parser only bounds values; the client helper intersects them with actual
groups before any iframe is rendered.

**Verify**:
`npm --workspace @esports-community-bot/web run lint` exits 0.

### Step 3: Make embed startup explicit and provider-correct

Refactor `embedUrl` in `stream-embed.tsx` to accept a named options object rather
than more positional booleans. Keep platform, handle, parent, and video ID typed.

Required URL behavior:

- Twitch: retain encoded `channel` and validated/encoded `parent`; add explicit
  `autoplay=true` and `muted=true` for grid use.
- Kick: retain encoded path handle; add `autoplay=true&muted=true`.
- YouTube: retain `youtube-nocookie.com` and encoded video ID; use
  `autoplay=0&playsinline=1`. Do not enable the JavaScript API and do not add an
  undocumented mute query parameter.
- Unsupported/non-embeddable input still returns `null`.

Extend `StreamEmbed` with a human-readable `label` prop and use
`<label> on <platform>` for the iframe title. Keep `allowFullScreen`, the existing
permissions, aspect ratio, and allowlisted URL construction. Add
`referrerPolicy="strict-origin-when-cross-origin"`.

Create `apps/web/src/test/stream-embed.test.ts` covering exact origins and query
parameters for Twitch/Kick/YouTube, encoding of unusual handles, required Twitch
parent, absence of autoplay/mute on YouTube as specified, and `null` for YouTube
without a live video ID. Assert no returned URL can use a host outside the three
existing CSP provider origins.

**Verify**:
`npm --workspace @esports-community-bot/web run test -- stream-embed.test.ts`
passes.

### Step 4: Build the media-first multiview grid

Create `apps/web/src/components/streams/multi-stream-grid.tsx` as a client
component. It receives selected `CoStream[]`, ordered `loadedIds`, `parent`,
localized strings, an `onLoad` callback, and an `onRemove` callback. Keep loaded
state controlled by `CoStreamsView`; the grid must not maintain a second copy of
selection/loading state. It must defensively render at most 9 items.

Structure:

- An unframed grid section, not a set of decorative nested cards. Use
  `multiviewGridClass(selected.length)` and stable `stream.id` keys.
- Each tile is a stable media frame: one aspect-video slot, followed by a
  compact metadata/action row containing creator name, platform badge, viewer
  count when live, external-open button, and remove icon button. Use `Badge`,
  `Button`, `PlatformIcon`, and `Tooltip` for unfamiliar icon-only actions.
  If the stream ID is not in `loadedIds`, the aspect-video slot holds a poster
  with creator name, platform badge, and a localized `Load stream` Button.
  Mount `StreamEmbed` only when the ID is loaded. Stable `stream.id` keys plus
  controlled loaded state ensure polling or removing a different tile does not
  remount an already-loaded iframe.
- If a selected group is offline or no longer has an embeddable live video, keep
  a fixed aspect-video black/empty media frame with localized offline text and
  the remove action; never collapse the tile and shift the entire grid.
- Use logical CSS (`ms`, `me`, `start`, `end`) and no physical LTR-only offsets.
- Wrap the grid and its compact toolbar in a `ref`-backed fullscreen container.
  Show fullscreen only when `document.fullscreenEnabled` and
  `requestFullscreen` exist. Call it from the button event, listen for
  `fullscreenchange`, expose enter/exit labels, catch rejection into an
  `aria-live="polite"` status, and remove listeners on unmount.
- Fullscreen styles must use a background, compact padding, and overflow auto.
  Do not assume all nine tiles fit above the fold on a laptop or phone.

Do not add focus-mode, drag handles, resizable panes, chat, or custom player
controls. Provider controls remain authoritative.

Add static-render assertions in the planned `.test.tsx` file using
`renderToStaticMarkup`: with every selected ID also present in `loadedIds`, 1,
3, and 9 selected streams produce exactly 1, 3, and 9 iframes; a 10-item prop
still produces at most 9; tile titles identify creator/platform; offline
selections retain one fixed tile but no iframe. Add a shared-link case where N
selected streams and only the first ID loaded render exactly one iframe and
N-1 `Load stream` posters. This pins the on-load bandwidth bound without making
the component infer browser-session history.

**Verify**:
the focused multiview test passes and web lint exits 0.

### Step 5: Replace single selection with explicit multi-selection UX

Refactor `CoStreamsView` without changing its public stream data contract.

State and derived values:

- Replace `selectedId` with ordered `selectedIds`, initialized through the pure
  helper and server props.
- Add ordered `loadedIds` state. On first render, load only the first selected
  group that is still live and embeddable. Other IDs restored from the URL stay
  selected but render posters. Do not encode `loadedIds` in the URL.
- `selectedStreams` maps IDs back to the latest polled groups in selection order.
- `selectableIds` contains only live groups with an `embedChannel`.
- Poll responses call `reconcileSelectedStreamIds`; they must not reset order,
  auto-add a replacement, or remove a group solely for going offline.
- When the viewer explicitly adds a stream through the Sheet or directory,
  append it to both `selectedIds` and `loadedIds` in the same state transition.
  Removing/clearing prunes both. Pressing a restored tile's `Load stream`
  action adds only that existing selected ID to `loadedIds`.
- Reconcile `loadedIds` as a subset of selected IDs when groups disappear.
  Keep a loaded ID when its stream merely goes offline so it can resume in the
  same tile if a later poll reports it live again.
- Every successful selection change updates the current URL with repeated
  `stream` parameters via `URL`/`URLSearchParams` and
  `history.replaceState`, preserving locale path and unrelated query values.

Controls and picker:

- Replace the single player block with `MultiStreamGrid`.
- Expand the page container from `max-w-5xl` to a media-appropriate maximum near
  120rem while preserving current responsive page padding. The brand/title must
  remain the first signal and the stream grid directly follows it.
- Add a compact toolbar: selected-count `Badge`, an `Add streams` Button, and a
  share Button. Build the share URL directly from current `selectedIds` using
  the same query helper as `history.replaceState`; do not wait for an effect and
  accidentally copy stale selection. Report `Link copied` through a short
  inline `aria-live` status; do not add a toast dependency.
- `Add streams` opens the installed shadcn `Sheet` from the bottom, constrained
  to a centered desktop max width and at most 85dvh. It must contain
  `SheetHeader`, `SheetTitle`, and `SheetDescription`, then the installed
  `Command` composition (`CommandInput`, `CommandList`, `CommandGroup`,
  `CommandItem`, `CommandEmpty`). Search against creator label, live title,
  live game, platform label, and language.
- Each CommandItem is a real selectable item with a checked state. Selected
  entries remain removable at the cap; unselected entries are disabled at 9.
  The footer displays `n / 9`, a localized cap message only when reached, and a
  `Clear all` Button when at least one stream is selected. Clear all empties
  selected/loaded state and removes only `stream` parameters from the URL.
- In the existing filtered creator directory, stop using a clickable `div` with
  `role="button"`. Render a normal item and a real icon Button with
  `aria-pressed` and localized add/remove labels. Keep external platform links
  separate so opening Twitch/Kick/YouTube never toggles selection.
- Offline and non-embeddable groups remain discoverable in the directory but
  cannot be added. Do not hide SOOP; it still has an external link.

Add these English keys to local `STR` and natural Arabic equivalents:
`multiView`, `addStreams`, `selectedCount`, `searchStreams`, `removeStream`,
`shareView`, `linkCopied`, `enterFullscreen`, `exitFullscreen`, `clearAll`,
`selectionLimit`, `loadStream`, `streamEnded`, and `fullscreenFailed`.

Suggested Arabic terminology:

- Multiview: `عرض متعدد`
- Add streams: `إضافة بثوث`
- Share view: `مشاركة العرض`
- Link copied: `تم نسخ الرابط`
- Load stream: `تحميل البث`
- Stream ended: `انتهى البث`
- Maximum message: `يمكنك اختيار 9 بثوث كحد أقصى.`

Use Lucide `ListPlus`, `Plus`, `X`, `Share2`, `Maximize2`, and `Minimize2` icons
where applicable. Icons inside Buttons use `data-icon`; do not hand-draw SVGs.

**Verify**:
web focused tests, lint, and build all pass.

### Step 6: Make polling lifecycle-aware

While editing the existing 60-second polling effect in `CoStreamsView`:

- Keep one in-flight request at a time with an `AbortController`.
- Skip interval polling while `document.visibilityState !== "visible"`.
- Refresh once when the tab becomes visible again.
- Abort and remove the interval/visibility listener on unmount.
- Preserve the last good stream data on network/JSON failure, as today.

This reduces unnecessary work while a page with several heavy iframes is in a
background tab. Do not change the server endpoint/cache cadence.

**Verify**:
lint passes; a focused pure/state test confirms a poll update cannot increase
selection beyond 9 or reorder selected IDs. The repository's Vitest environment
is node-only, so do not add jsdom merely to unit-test `visibilitychange` or
`AbortController`; verify those browser lifecycle behaviors in Step 8.

### Step 7: Add disposable nine-stream visual fixtures

Extend `scripts/seed-dev.mjs` only for local visual QA:

- Import `createStreamChannel` and `upsertStreamStatus`.
- Upsert nine idempotent `ewc`-scope demo creator groups across Twitch, Kick,
  and YouTube, with unique creator keys, labels, game tags, languages, default
  channels, live titles, viewer counts, and `category: "Valorant"`.
- Give YouTube demo rows placeholder video IDs so their iframe frames render;
  the seed must perform no external HTTP requests.
- Print the number of co-stream fixtures seeded.
- Keep the existing hard refusal when `DB_PATH` is absent. Never point this seed
  at production.

This fixture is part of the development baseline, not production data. It lets
future maintainers reproduce 1-9 layouts without waiting for nine real streams.

**Verify**:
delete/use a fresh disposable SQLite path, run `npm run seed:dev` twice, and
confirm both runs exit 0 without duplicate-row errors.

### Step 8: Perform EN/AR responsive and fullscreen QA

Start only the web app against the disposable seeded DB (do not start the bot,
which would poll the fake handles offline). Verify both `/co-streams` and
`/ar/co-streams` at:

- 390x844: 1, 2, and 9 selections; one-column scroll; bottom Sheet stays within
  85dvh; no clipped labels or horizontal page scroll.
- 768x1024: 2, 4, and 9 selections; controls wrap cleanly; iframe controls remain
  reachable.
- 1440x900: 1, 3, 4, 6, and 9 selections; two-column layout; orphan rows remain
  aligned and stable.
- 1920x1080: 3, 6, and 9 selections; three-column layout; whole-grid fullscreen
  enters/exits and Esc works.

For every case, evaluate:

```js
document.documentElement.scrollWidth === document.documentElement.clientWidth
```

It must be `true`. Also confirm the number of grid iframes never exceeds 9,
adding a tenth is blocked with feedback, and removing a stream does not reload
other iframe DOM nodes (stable keys). Open a shared nine-stream URL in a fresh
tab and confirm only the first selected tile mounts an iframe while the other
eight render `Load stream` posters. Confirm each poster loads only its own tile;
then add a new stream from the Sheet and confirm that explicit add loads in one
action. Platform links must not toggle selection. An Arabic shared URL must
reload with RTL intact and the same selected order.

Save screenshots outside the repository for reviewer evidence; commit none.

**Verify**:
all viewport checks above pass, with no console errors caused by application
code. Provider offline/error screens from fake handles are acceptable.

### Step 9: Correct the bilingual embed privacy disclosure

Update `LAST_UPDATED` in `apps/web/src/app/privacy/page.tsx`. In both English
and Arabic, state that displaying co-stream players sends standard request
metadata to Twitch, Kick, or YouTube and those providers apply their own privacy
and cookie policies. Correct the Infrastructure and Data Processors sentence so
it no longer claims those embed providers are absent.

Do not claim that the site controls provider cookies, does not transfer request
metadata, or can revoke provider-side data. Keep the wording factual and concise.

**Verify**:
web lint and build pass; inspect `/privacy` and `/ar/privacy` for correct LTR/RTL.

### Step 10: Run the full repository gates and inspect scope

Run, in order:

1. `npm test`
2. `npm --workspace @esports-community-bot/web run lint`
3. `npm --workspace @esports-community-bot/web run test`
4. `npm run web:build`
5. `git diff --check`
6. `git status --short`

Every command must succeed. `git status` may show only files in Scope plus the
pre-existing unrelated image files already present in the operator's main
worktree; do not stage, delete, or modify those images.

## Test plan

- `apps/web/src/test/co-stream-multiview.test.tsx`
  - bounds and sanitizes repeated query IDs;
  - no-query default vs explicit stale query;
  - add/remove/dedupe/cap behavior;
  - offline preservation and removed-group pruning;
  - literal grid classes for 0-9;
  - static rendering of 1, 3, 9, and defensive 10-item inputs;
  - shared selections mount only the first loaded ID and render posters for the
    remainder; fully loaded selections can still render up to 9 iframes;
  - stable offline placeholder without an iframe.
- `apps/web/src/test/stream-embed.test.ts`
  - allowlisted hosts and encoded provider identifiers;
  - Twitch parent/autoplay/mute;
  - Kick autoplay/mute;
  - YouTube no-cookie/autoplay-off/playsinline and missing-video fallback.
- Existing `co-streams.test.ts` remains green and proves creator/platform
  grouping still chooses exactly one embed channel per creator.
- Full repository tests ensure MCP, tournament strips, status polling, admin
  management, and public APIs retain their existing contracts.

## Done criteria

- [ ] A viewer can add and remove live embeddable creator groups from 0 through
      9 using real accessible controls.
- [ ] A tenth selection cannot enter state or render an iframe.
- [ ] Repeated `stream` query parameters recreate a shared selection in order;
      arbitrary/stale IDs cannot influence iframe hosts or handles.
- [ ] Poll updates preserve selected order and offline tiles; removed DB groups
      are pruned without replacing them.
- [ ] Twitch/Kick multiview embeds start explicitly muted; YouTube starts only
      on viewer interaction and plays inline on mobile.
- [ ] On initial load, including a shared nine-`stream` URL, at most the first
      selected tile mounts an iframe; restored remainder tiles are `Load stream`
      posters. Streams explicitly added in-session load in the same add action.
- [ ] The auto grid is one column on mobile, two on regular desktop, and three
      only on very wide screens; all tested viewports have no horizontal scroll.
- [ ] Fullscreen is feature-detected, keyboard-exitable, and failure-safe.
- [ ] The shadcn Sheet/Command picker is searchable, capped, bilingual, keyboard
      accessible, and visually correct in RTL.
- [ ] Privacy copy names external player providers and request processing in EN
      and AR.
- [ ] `npm test`, web lint, web tests, web build, and `git diff --check` pass.
- [ ] No package, lockfile, API, DB schema, admin, MCP, or CSP file changed.
- [ ] `plans/README.md` marks Plan 093 DONE only after all checks pass.

## STOP conditions

Stop and report instead of improvising if:

- The drift check shows the current grouping no longer guarantees one
  `embedChannel` per creator group, or the stream ID is no longer stable across
  60-second API polls.
- A solution appears to require accepting arbitrary URLs/handles from query
  parameters, broadening `frame-src`, or bypassing `parentHost` validation.
- Coordinated mute/audio requires loading Twitch or YouTube JavaScript SDKs,
  postMessage control, or an undocumented provider parameter. Keep the v1
  startup policy from this plan and report the limitation.
- Provider behavior shows that more than one embed from a platform is prohibited
  for this domain/account. Report the provider/error and do not hide it with a
  proxy or alternate host.
- The feature requires a database migration, API response change, or new npm
  dependency.
- A verification step fails twice after a reasonable correction.
- Any in-scope source has materially drifted from the Current state contract.

## Maintenance notes

- The nine-player cap is a UX/performance boundary as well as a state invariant;
  keep it shared through `MAX_MULTI_STREAMS` rather than duplicating the number.
- SOOP remains link-only until an official embeddable player is supported and
  explicitly added to CSP plus tests.
- Selected creator groups deliberately honor the admin default platform. A
  future per-tile platform switch must still prevent loading duplicate platforms
  for one creator unless the user explicitly asks for that behavior.
- Fullscreen does not guarantee all nine tiles fit without scrolling on smaller
  displays. Preserving usable player dimensions is preferable to tiny controls.
- Cross-provider audio focus, chat, drag reorder, and saved signed-in layouts are
  reasonable follow-ups only after production usage shows demand. Keep them out
  of the initial multiview PR.
- Reviewers should scrutinize iframe count, URL trust boundaries, iframe remounts
  during selection changes, RTL logical properties, and the 390px layout.
