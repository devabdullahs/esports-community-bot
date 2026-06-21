# Plan 057: Co-stream management polish — group integrity, tests, platform logos, dedup

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. Touch
> only the files listed in each part's Scope. If any STOP condition occurs, stop
> and report — do not improvise.
>
> **Drift check (run first)**:
> `git diff --stat ec39ad6..HEAD -- src/db/streamChannels.js apps/web/src/lib/co-streams.ts apps/web/src/lib/stream-validation.ts apps/web/src/components/streams/co-streams-view.tsx apps/web/src/components/admin/stream-channels-manager.tsx "apps/web/src/app/api/admin/streams/[id]/route.ts"`
> If any of these changed since `ec39ad6`, compare the "Current state" excerpts
> below against the live code before proceeding; on a real mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M (parts are independent; ~half a day total with tests)
- **Risk**: LOW (one MED part: B touches a shared DB write)
- **Depends on**: none
- **Category**: bug + tests + tech-debt
- **Planned at**: commit `ec39ad6`, 2026-06-21

## Why this matters

The co-stream feature (admin `/admin/streams` + public `/co-streams`) groups a
streamer's multiple platform channels by `creatorKey` and picks one `isDefault`
embed. Four small gaps undercut that model: (A) the public grouping/aggregation
has **zero tests** and contains two real aggregation bugs; (B) editing a
streamer's label/language/games updates only the clicked platform row, so the
other platforms of the same creator drift out of sync; (C) the creator-key /
game-slug normalization is copy-pasted in four places and can silently diverge;
(D) every "open on" link renders a generic arrow icon instead of the platform's
logo, so Twitch/Kick/YouTube/SOOP links are visually indistinguishable.

After this plan: the grouping logic is tested and correct, a creator's platforms
stay consistent on edit, normalization lives in one place, and links show
platform logos.

## Repo conventions

- Bot code is ESM JS, single quotes, sparse why-comments, prepared-statement DB
  modules using `$1`-style placeholders via `src/db/client.js` (`all/get/run`).
  Tests are `node:test` in `tests/*.test.mjs` (run with `npm test`).
- Web is Next.js App Router + TypeScript. Tests are `vitest` in
  `apps/web/src/test/*.test.ts`. Pure-logic test exemplar:
  `apps/web/src/test/validators.test.ts`.
- Custom inline-SVG icon component exemplar: `apps/web/src/components/discord-icon.tsx`
  (24×24 viewBox, `fill="currentColor"`, `aria-hidden`).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install (worktree) | `npm install` | exit 0 |
| Bot tests | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

---

## Part A — Test the public grouping + fix two aggregation bugs

**In scope**: `apps/web/src/lib/co-streams.ts`, `apps/web/src/test/co-streams.test.ts` (create).
**Out of scope**: the bot DB modules, the view component.

### Current state (`apps/web/src/lib/co-streams.ts`)

`getEwcCoStreams()` fetches active EWC channels, merges live status, groups by
`groupKey`, and for each group computes the view model. Two bugs in that
per-group computation (lines ~88-94):

```ts
isLive: liveChannels.length > 0,
liveTitle: liveChannels.find((c) => c.liveTitle)?.liveTitle ?? null,
viewerCount: liveChannels.reduce((sum, c) => sum + (c.viewerCount ?? 0), 0) || null,   // BUG 1: sums across platforms
startedAt: liveChannels.map((c) => c.startedAt).filter((v): v is number => typeof v === "number").sort()[0] ?? null,  // BUG 2: lexicographic sort
```

- **BUG 1**: when a creator is live on Twitch *and* Kick, `viewerCount` becomes
  the **sum**, inflating the headline number and the live-sort ordering
  (`out.sort` compares `viewerCount`). It should be the headline count of the
  channel you'd actually watch.
- **BUG 2**: `.sort()` with no comparator sorts numbers as strings.

### Steps

**A1.** In `co-streams.ts`, extract the grouping into a pure, exported function so
it is testable without a database. Add:

```ts
import type { CoStream, CoStreamChannel, StreamPlatform } from "@/lib/stream-types";
// ...existing imports unchanged...

const EMBEDDABLE = new Set<StreamPlatform>(["twitch", "kick"]);  // (already present — keep one copy)

// Pure: group already-status-merged channels into the public view model.
export function buildCoStreamGroups(merged: CoStreamChannel[]): CoStream[] {
  // move the existing grouping body here (the `groups` Map build, the
  // `[...groups.entries()].map(...)`, and the final `out.sort(...)`),
  // returning `out`.
}
```

Then make `getEwcCoStreams()` do only: fetch channels → merge status into
`merged` → `return buildCoStreamGroups(merged);`. Keep `groupKey`,
`pickEmbedChannel`, and `uniq` as module-private helpers used by
`buildCoStreamGroups`.

**A2.** Fix BUG 1 — replace the summed `viewerCount` with the headline count of
the group's embed channel, falling back to the max across live channels:

```ts
const embedChannel = pickEmbedChannel(group);
const liveChannels = group.filter((c) => c.isLive);
const headlineViewers =
  (embedChannel?.isLive ? embedChannel.viewerCount : null) ??
  (liveChannels.length ? Math.max(...liveChannels.map((c) => c.viewerCount ?? 0)) : null);
// use `viewerCount: headlineViewers` in the returned object
```

**A3.** Fix BUG 2 — numeric min for `startedAt`:

```ts
startedAt: liveChannels
  .map((c) => c.startedAt)
  .filter((v): v is number => typeof v === "number")
  .sort((a, b) => a - b)[0] ?? null,
```

**A4.** Create `apps/web/src/test/co-streams.test.ts` (vitest; model after
`apps/web/src/test/validators.test.ts`). Build `CoStreamChannel[]` fixtures by
hand (no DB) and assert `buildCoStreamGroups`:
  - groups two channels with the same `creatorKey`+`scope` into one `CoStream`
    with `channels.length === 2`;
  - keeps two different creators as two groups;
  - `embedChannel` prefers a live default embeddable channel, then any live
    embeddable, then any default embeddable, then any embeddable, else `null`;
  - **BUG 1 regression**: a creator live on Twitch (viewers 1000) + Kick
    (viewers 400) yields group `viewerCount === 1000` (the embed/max), **not**
    1400;
  - **BUG 2 regression**: with `startedAt` values `[1781970000, 1781967600]`
    the group `startedAt === 1781967600` (numeric min);
  - groups sort live-first, then by `viewerCount` desc.

**Verify**: `npm --workspace @esports-community-bot/web run test` → all pass,
including the new `co-streams.test.ts` (≥5 assertions).

---

## Part B — Propagate creator-level edits to all of a creator's platforms

**In scope**: `src/db/streamChannels.js`, `tests/streamChannels.test.mjs`.
**Out of scope**: the web layer (no API/UI change needed — the admin already
sends label/language/gameSlugs on edit).

### Why

`label`, `language`, and game tags are **creator-level** attributes, but
`updateStreamChannel` writes one row. Editing a streamer's Twitch row leaves
their Kick row's label/language/games stale, so the public group's display label
(`co-streams.ts` uses `group[0].label`) depends on row order. Propagate these
three attributes to the creator's sibling rows so a group stays consistent.

### Current state (`src/db/streamChannels.js`, `updateStreamChannel`)

```js
export async function updateStreamChannel(id, { label, language, sortOrder, active, gameSlugs, isDefault, creatorKey } = {}) {
  const sets = [];
  const params = [];
  const push = (col, value) => { params.push(value); sets.push(`${col} = $${params.length}`); };
  if (label !== undefined) push('label', blank(label));
  // ...creatorKey, language, sortOrder, active...
  if (gameSlugs !== undefined) { const games = parseGameSlugs(gameSlugs); push('game_slug', games[0] || ''); push('game_slugs', gameSlugsJson(games)); }
  if (isDefault !== undefined) push('is_default', isDefault ? 1 : 0);
  if (!sets.length) return getStreamChannel(id);
  push('updated_at', nowText());
  params.push(id);
  const info = await run(`UPDATE stream_channels SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
  if (!info.changes) return null;
  const updated = await getStreamChannel(id);
  if (updated?.isDefault && updated.creatorKey) {
    await run('UPDATE stream_channels SET is_default = 0 WHERE creator_key = $1 AND id <> $2', [updated.creatorKey, id]);
    return getStreamChannel(id);
  }
  return updated;
}
```

### Steps

**B1.** After the row is updated and `updated` is fetched, if the patch included
any of `label`, `language`, or `gameSlugs`, propagate **those columns only** to
sibling rows with the same `creator_key` and `scope` (never touching
`is_default`, `active`, or `sort_order`, which stay per-row). Build the sibling
UPDATE with the same distinct-placeholder discipline already used in this file
(no placeholder reuse across the two IN-style clauses). Pseudostructure:

```js
// after `const updated = await getStreamChannel(id);` and BEFORE the is_default block,
// or interleaved — order does not matter as long as both run:
if (updated?.creatorKey && (label !== undefined || language !== undefined || gameSlugs !== undefined)) {
  const sib = [];
  const sp = [];
  const spush = (col, value) => { sp.push(value); sib.push(`${col} = $${sp.length}`); };
  if (label !== undefined) spush('label', blank(label));
  if (language !== undefined) spush('language', blank(language));
  if (gameSlugs !== undefined) {
    const games = parseGameSlugs(gameSlugs);
    spush('game_slug', games[0] || '');
    spush('game_slugs', gameSlugsJson(games));
  }
  spush('updated_at', nowText());
  sp.push(updated.creatorKey);
  sp.push(updated.scope);
  sp.push(id);
  await run(
    `UPDATE stream_channels SET ${sib.join(', ')} WHERE creator_key = $${sp.length - 2} AND scope = $${sp.length - 1} AND id <> $${sp.length}`,
    sp,
  );
  return getStreamChannel(id);
}
```

Keep the existing `is_default` clearing block working (both can run; if both
return early, ensure the function still returns the fresh row).

**B2.** Add a test in `tests/streamChannels.test.mjs` (model after the existing
`only one platform is default within a creator group` test): create two channels
with the same `creatorKey` + `scope` ('ewc') on twitch + kick; call
`updateStreamChannel(twitchId, { label: 'New Name', gameSlugs: ['valorant'] })`;
assert **both** rows now have `label === 'New Name'` and
`gameSlugs` deep-equals `['valorant']`; and assert a per-row attribute you did
NOT pass (e.g. each row's `handle`, or `isDefault` if you set them differently)
is unchanged.

**Verify**: `npm test` → all pass, including the new propagation test.

---

## Part C — Consolidate the web-side normalization helpers

**In scope**: create `apps/web/src/lib/stream-normalize.ts`; edit
`apps/web/src/lib/stream-validation.ts`,
`apps/web/src/app/api/admin/streams/[id]/route.ts`,
`apps/web/src/components/admin/stream-channels-manager.tsx`.
**Out of scope**: `src/db/streamChannels.js` — the bot module is the source of
truth and runs in a different module system; the web helpers MUST mirror its
behavior but are maintained separately. Do not try to import bot JS into the
client bundle.

### Why

The same creator-key slugify and game-slug normalize logic is hand-copied in
four spots; they can drift. Centralize the web copies into one client-safe
module.

### Current duplicate sites

- `stream-channels-manager.tsx:58` `creatorKeyFrom()` (client component).
- `app/api/admin/streams/[id]/route.ts:32-38` inline creator-key normalize.
- `stream-validation.ts` `normalizeGameSlug`/`normalizeGameSlugs` + inline
  creator-key normalize in `validateStreamChannelInput`.

### Steps

**C1.** Create `apps/web/src/lib/stream-normalize.ts` (NO `"server-only"` — a
client component imports it):

```ts
// Mirrors the bot's normalization in src/db/streamChannels.js. Keep in sync.
export function normalizeCreatorKey(value: unknown): string {
  return (typeof value === "string" ? value : "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function normalizeGameSlug(value: unknown): string {
  return (typeof value === "string" ? value : "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 60);
}

export function normalizeGameSlugs(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? "").split(/[,،;|/\s]+/u).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const slug = normalizeGameSlug(item);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out.slice(0, 12);
}
```

(These bodies are copied verbatim from the existing `stream-validation.ts` /
`manager.tsx` implementations so behavior is unchanged.)

**C2.** Replace the four duplicate sites with imports from
`@/lib/stream-normalize`:
  - `stream-validation.ts`: delete its local `normalizeGameSlug` /
    `normalizeGameSlugs` and the inline creator-key slugify; import all three
    and use them.
  - `[id]/route.ts`: replace the inline `patch.creatorKey = body.creatorKey...`
    slugify with `normalizeCreatorKey(body.creatorKey)`.
  - `stream-channels-manager.tsx`: delete `creatorKeyFrom`, import
    `normalizeCreatorKey`, and use it where `creatorKeyFrom(...)` was called.

**C3.** Add `apps/web/src/test/stream-normalize.test.ts` (vitest) with a few
assertions: `normalizeCreatorKey("OW Brain!!")` → `"ow-brain"`;
`normalizeGameSlugs("overwatch, rocket-league، valorant")` →
`["overwatch","rocketleague","valorant"]` (note: the executor must confirm
whether `rocket-league` normalizes to `rocketleague` here — the **web**
`normalizeGameSlug` only strips non-alphanumerics, giving `rocketleague`; it does
NOT apply the bot's `normalizeGameSlug` alias map. Assert `"rocketleague"`).

**Verify**: web lint + web test pass; `grep -n "creatorKeyFrom" apps/web/src` →
no matches.

---

## Part D — Platform logos on "open on" links

**In scope**: add dependency `@icons-pack/react-simple-icons`; create
`apps/web/src/components/platform-icon.tsx`; edit
`apps/web/src/components/streams/co-streams-view.tsx` and
`apps/web/src/components/admin/stream-channels-manager.tsx`.
**Out of scope**: the embed iframe component; any non-platform external link.

### Why

Every "open on <platform>" link and the admin handle-link render a generic
`ExternalLinkIcon` arrow, so Twitch / Kick / YouTube / SOOP are visually
identical. Show each platform's logo. `lucide-react` in this repo (`^1.17.0`)
does **not** export brand icons (verified: `Twitch`/`Kick`/`Youtube` are
undefined), so use the maintained `simple-icons` brand set.

### Steps

**D1.** Add the dependency to the **web workspace**:
`npm install --workspace @esports-community-bot/web @icons-pack/react-simple-icons`.
Confirm it resolves `SiTwitch`, `SiKick`, `SiYoutube`. For SOOP, check whether
`SiSoop` is exported by the installed version (`node -e "const i=require('@icons-pack/react-simple-icons'); console.log(!!i.SiTwitch,!!i.SiKick,!!i.SiYoutube,!!i.SiSoop)"`).

**STOP condition**: if `SiTwitch`, `SiKick`, or `SiYoutube` is missing, STOP and
report (the package API differs from this plan). If only `SiSoop` is missing,
that is fine — use the `DiscordIcon`-style fallback for SOOP only (see D2).

**D2.** Create `apps/web/src/components/platform-icon.tsx`:

```tsx
import type { ComponentProps } from "react";
import { SiTwitch, SiKick, SiYoutube } from "@icons-pack/react-simple-icons";
import type { StreamPlatform } from "@/lib/stream-types";

// SOOP fallback if the installed simple-icons set lacks it (DiscordIcon pattern).
function SoopIcon(props: ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" {...props}>
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-2 6 6 4-6 4V8Z" />
    </svg>
  );
}

const ICONS = { twitch: SiTwitch, kick: SiKick, youtube: SiYoutube, soop: SoopIcon } as const;

export function PlatformIcon({
  platform,
  className,
}: {
  platform: StreamPlatform;
  className?: string;
}) {
  const Icon = ICONS[platform];
  // simple-icons components accept `size`/`color`/`className`; pass className for sizing.
  return <Icon className={className} aria-hidden />;
}
```

If `SiSoop` IS available, import it and use it instead of the `SoopIcon`
fallback (drop the fallback). (The fallback path above is a generic play glyph —
acceptable only as a last resort for SOOP.)

**D3.** In `co-streams-view.tsx`, replace the platform "open on" link icons with
`<PlatformIcon platform={channel.platform} className="size-4" />`:
  - the embed-area "Open on …" buttons (the `<ExternalLinkIcon data-icon="inline-end" />`);
  - the per-card external-link anchors (the `<ExternalLinkIcon className="size-4" />`).
  Keep the `RadioIcon`/`UsersIcon` usages untouched. Remove the now-unused
  `ExternalLinkIcon` import if nothing else uses it.

**D4.** In `stream-channels-manager.tsx`, replace the handle-link
`<ExternalLinkIcon className="size-3" />` (the anchor wrapping `{channel.handle}`)
with `<PlatformIcon platform={channel.platform} className="size-3" />`. Leave
`PencilIcon`/`Trash2Icon`/`StarIcon`/`PlusIcon`/`CheckIcon` untouched. Remove the
`ExternalLinkIcon` import if unused afterward.

**Verify**: web lint + web build pass;
`grep -rn "ExternalLinkIcon" apps/web/src/components/streams apps/web/src/components/admin/stream-channels-manager.tsx` returns only lines you intentionally kept (ideally none).

---

## Test plan (all parts)

- `apps/web/src/test/co-streams.test.ts` (new) — Part A grouping + the two
  regression cases.
- `apps/web/src/test/stream-normalize.test.ts` (new) — Part C helpers.
- `tests/streamChannels.test.mjs` (extend) — Part B group-edit propagation.
- Parts D has no unit test (pure presentational); covered by web build + lint.

## Done criteria (ALL must hold)

- [ ] `npm test` exits 0 (bot suite green, incl. the new Part B test).
- [ ] `npm --workspace @esports-community-bot/web run test` exits 0 (incl. the two new web tests).
- [ ] `npm --workspace @esports-community-bot/web run lint` exits 0.
- [ ] `npm run web:build` exits 0.
- [ ] `grep -n "creatorKeyFrom" apps/web/src` → no matches (Part C).
- [ ] `grep -rn "reduce((sum" apps/web/src/lib/co-streams.ts` → no matches (Part A BUG 1 gone).
- [ ] No files outside the per-part Scope lists are modified (`git status`).

## STOP conditions

- The drift check shows any in-scope file changed since `ec39ad6` and the
  "Current state" excerpts no longer match.
- Part D: `@icons-pack/react-simple-icons` does not export `SiTwitch`/`SiKick`/`SiYoutube`.
- Part B: the sibling-propagation UPDATE would require placeholder reuse to
  express (it should not — push every value distinctly); if you find yourself
  reusing a `$n` across clauses, STOP (this repo had a Postgres bug from exactly
  that).
- Any web test for Part A/C fails twice after a reasonable fix attempt.

## Maintenance notes

- Part B makes `updateStreamChannel` write multiple rows; a reviewer should
  confirm the sibling UPDATE only sets creator-level columns and never
  `is_default`/`active`/`sort_order`.
- `stream-normalize.ts` (Part C) **mirrors** `src/db/streamChannels.js`; if the
  bot's normalization changes, update both. Note the web `normalizeGameSlug`
  does not apply the bot's alias map (`normalizeGameSlug` in `src/lib/games.js`),
  so `tft`-style aliases are normalized bot-side only — this is pre-existing and
  out of scope here.
- Part D adds a runtime dependency; if bundle size is ever a concern, the
  brand icons can be hand-rolled SVGs (see `discord-icon.tsx`).
