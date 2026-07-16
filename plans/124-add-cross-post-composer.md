# Plan 124: Add a cross-post composer for site, Discord, and social drafts

> **Executor instructions**: This plan creates drafts and prepared links. It
> must not publish to external social platforms automatically.
>
> **Drift check**: `git diff --stat 27a04f8..HEAD -- apps/web/src/components/admin/news-editor.tsx src/jobs/newsAnnouncer.js src/jobs/mediaAnnouncer.js src/db/ewcNewsDiscordPosts.js`

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/120-add-scheduled-publishing-calendar.md recommended
- **Category**: direction
- **Planned at**: commit `27a04f8`, 2026-07-17

## Why this matters

Media managers should not jump between several tools to prepare a post. A
cross-post composer can publish the website article, schedule/preview the
Discord announcement, and generate prefilled X/Twitter copy in one flow.

## Current state

- `apps/web/src/components/admin/news-editor.tsx` already creates and publishes
  game/media posts.
- `src/jobs/newsAnnouncer.js` posts published news to Discord.
- `src/jobs/mediaAnnouncer.js` handles media channel Discord announcements.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Bot tests | `npm test` | all pass |
| Focused web tests | `npm --workspace @esports-community-bot/web run test -- cross-post` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- Composer UI in the news editor.
- Discord announcement preview using existing payload builders.
- Prefilled X/Twitter intent link and copy helper.
- Optional scheduling integration if plan 120 is merged.
- tests.

**Out of scope**:
- Posting directly to X/Twitter, Instagram, TikTok, or YouTube.
- OAuth for social platforms.
- Changing the Discord announcer lifecycle beyond preview/schedule hooks.

## Steps

### Step 1: Extract preview builders

Refactor Discord announcement payload formatting into reusable pure helpers that
both jobs and web previews can use. Keep Discord send/edit side effects in jobs.

**Verify**: bot tests cover payload parity before/after extraction.

### Step 2: Add composer controls

In the news editor, add a cross-post panel with website status, Discord preview,
and X/Twitter copy. Respect media/game ownership and publish readiness.

**Verify**: web tests cover game post, media post, draft, and published states.

### Step 3: Add prefilled social draft links

Generate `https://twitter.com/intent/tweet?...` or `https://x.com/intent/post?...`
with title, canonical URL, and optional hashtags. Do not send the request
server-side.

**Verify**: tests cover URL encoding and no secret/private fields.

## Done criteria

- [ ] Editors can preview Discord and prepare social copy from one screen.
- [ ] Website publishing behavior remains unchanged.
- [ ] No external social auto-posting exists.
- [ ] Full verification passes.

## STOP conditions

- Product requires direct social OAuth posting.
- Discord preview extraction would require broad announcer rewrites.

## Maintenance notes

This is the bridge between editorial workflow and future monetization. Keep
copy helpers centralized so sponsored posts can reuse them later.
