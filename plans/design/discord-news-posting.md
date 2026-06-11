# Design: Auto-post published news to Discord

> Status: spike complete — ready for operator review and split into build plans.
> Spike branch: `advisor/017-discord-news-spike`

---

## Goal

Bridge the admin news system to Discord so that publishing a bilingual post on
the dashboard automatically announces it in the community server. Admins
should not have to copy-paste; the bot should own the delivery channel.

---

## Evidence of intent

`apps/web/src/app/admin/page.tsx:65` reads, in the admin access card:

> "Published posts appear on the matching game page. **Discord publishing can
> connect next.**"

That comment is an explicit product intention, not an accident.

---

## Data inventory

### Post shape after hydration (`src/db/ewcNewsPosts.js:42-71`)

```
{
  id:              integer (autoincrement PK)
  gameSlug:        string   -- e.g. "valorant", "honorofkings"
  contentMode:     "shared" | "translated"
  defaultLocale:   "en" | "ar"
  status:          "draft" | "published"
  authorDiscordId: string | null
  authorName:      string | null
  coverImageUrl:   string | null
  createdAt:       ISO datetime string
  updatedAt:       ISO datetime string
  publishedAt:     ISO datetime string | null
  translations: {
    en?: { locale, title, summary, body }   -- caps: title 90, summary 180, body 12000
    ar?: { locale, title, summary, body }
  }
  -- plus the resolved top-level locale/title/summary/body (from withResolvedFields)
}
```

Key observations:
- `contentMode = "shared"` → one locale in `translations`; `"translated"` → both `en`
  and `ar` present (enforced by `normalizeInput`, `src/db/ewcNewsPosts.js:84-129`).
- `getTranslationForLocale(post, locale)` falls back: requested → `defaultLocale`
  → `en` → `ar` → null (`src/lib/ewcNewsContent.js:95-106`).
- Body cap is 12,000 chars; Discord embed description cap is 4,096; full content
  message cap is 2,000. Neither body nor summary fits raw into a single Discord
  message without truncation.
- The `ewc_news_posts` table has NO `discord_message_id` or `posted_at` column
  today (`src/db/index.js:221-237`). The side-table approach adds zero drift risk
  to the existing schema.

### Settings get/set pattern (`src/db/settings.js`)

All per-guild settings live in `guild_settings`. The add-a-channel idiom:

1. Declare a dedicated `set<Feature>` function that does an
   `INSERT … ON CONFLICT … DO UPDATE` (upsert) on `guild_settings`
   (e.g. `setEwcPredictionsChannel`, lines 27-33).
2. In `src/db/index.js` add the new column to the `ensureColumns('guild_settings', […])`
   call at line 68-88 so existing deployments migrate automatically on next
   boot.
3. Read it back with `getSettings(guildId).ewc_news_channel_id` (the universal
   getter at line 5-7 returns `{}` on miss, so `?.` access is safe).

The `CHANNEL_FIELDS` allowlist on line 3 is only used by the generic `setChannel`
helper; feature-specific setters bypass it, as every existing EWC-feature setter
does (lines 19-75).

### Announce exemplar (`src/jobs/ewcPredictions.js:175-182`)

```js
async function announce(client, guildId, content) {
  if (!client) return;
  const channelId = getSettings(guildId).ewc_predictions_channel_id;
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  await channel.send({ content }).catch(
    (error) => logger.warn(`[ewc-predictions] announcement failed: ${error.message}`)
  );
}
```

Pattern: read channel id from settings → fetch the channel object → guard
`isTextBased()` → send with swallowed error + logger warn. The send also uses
`allowedMentions: { parse: [] }` on the leaderboard sends (lines 151-152) to
avoid accidental pings.

### Job cadence (`src/jobs/ewcPredictions.js:353-360`, `src/config.js:64-69`)

```js
export function startEwcPredictions(client) {
  const minutes = Math.max(15, config.ewcPredictions.refreshMinutes);
  const run = () => runEwcPredictionAutomation(client).catch(…);
  timer = setInterval(run, minutes * 60 * 1000);
  timer.unref?.();
  …
  run();
}
```

The `setInterval` + `timer.unref()` pattern is the standard job loop in this
codebase. The job registration happens in `src/index.js` via the `stop*` imports
at lines 9-12; a new news job would be `stopEwcNews` in the same shutdown block.

### No HTTP server in the bot

`grep` across `src/` for `createServer`, `app.listen`, `express()`, `fastify`,
`koa()`, `Hono` returns zero matches in bot source files. `src/index.js` never
calls `listen`. The bot has no inbound HTTP interface. Web→bot HTTP push does
not exist and would require adding a dependency and exposing a port.

---

## The four decisions

### Decision 1 — Trigger: DB polling (RECOMMENDED)

**Options**

| Option | Mechanism | Prerequisites |
|---|---|---|
| A — DB poll (recommended) | Bot `setInterval` job reads `ewc_news_posts` for unposted published rows | None — the bot already owns the SQLite file |
| B — Web push | Web hits an internal bot HTTP endpoint on status change | Requires adding an HTTP server to the bot (new dep, new env vars, new attack surface) |

**Recommendation: Option A.**

The bot has no HTTP server (verified above). Adding one is disproportionate to
the problem. The bot already owns the SQLite file via `src/db/connection.js`
and all other jobs use polling. A 2-minute `setInterval` means maximum 2 min
latency between publish and Discord post — acceptable for a community news feed.

**Query shape:**
```sql
SELECT p.* FROM ewc_news_posts p
LEFT JOIN ewc_news_discord_posts d ON d.post_id = p.id
WHERE p.status = 'published' AND d.post_id IS NULL
ORDER BY p.published_at ASC;
```
The `LEFT JOIN … IS NULL` anti-join is the most portable SQLite pattern for
"not yet posted". Alternative: an `ewc_news_posted_at` column on the main
table, but the side-table keeps `ewc_news_posts` clean (see Decision 3).

**Interval**: 2 minutes (`EWC_NEWS_REFRESH_MINUTES` env var, default 2,
minimum 1). Intentionally shorter than the predictions job (15 min) because
news timeliness matters more.

---

### Decision 2 — Destination: one configured news channel (RECOMMENDED)

**Options**

| Option | Pros | Cons |
|---|---|---|
| A — One `ewc_news_channel_id` in `guild_settings` (recommended) | Simplest; matches all existing channel-config patterns | No per-game routing |
| B — Per-game channels (extend `game_match_cards` model) | Granular routing | Operators must configure N channels; adds UI complexity; deferred scoping |

**Recommendation: Option A for v1.** Use a single `ewc_news_channel_id` in
`guild_settings`. The game tag (`gameSlug`) is included in the embed footer so
members can filter manually if needed.

**Admin config command**: model on `/set_ewc` (`src/commands/set_ewc.js`) — a
dedicated top-level command (`/set_news_channel`) with a single required
`channel` option and an audit log write. Alternatively, add a `news` subcommand
to the existing `/set_channel` command (`src/commands/set_channel.js:23-80`)
since it already handles the multi-subcommand pattern; the news channel is
simpler (no per-game dimension) so it fits as `set_channel news`.

---

### Decision 3 — Format: embed with summary + "Read more" link (RECOMMENDED)

**Options**

| Option | Discord char usage | Notes |
|---|---|---|
| A — Embed: title + summary + cover image + "Read more" link (recommended) | title ≤ 256 (post title ≤ 90 ✓); description ≤ 180 (summary cap ✓); image URL; URL field | Fits without truncation for all valid posts |
| B — Embed: title + truncated body | description cap 4,096; body cap 12,000 → truncation at 4,096 chars | Lossy; "read more on web" still needed |
| C — Plain message | content cap 2,000; body cap 12,000 → 83% truncation | Worst fit; no image |

**Recommendation: Option A.**

The summary field (`NEWS_SUMMARY_MAX_LENGTH = 180`, `src/lib/ewcNewsContent.js:2`)
is _designed_ for exactly this use: a short teaser. The embed description limit
is 4,096 — the 180-char summary fits comfortably with no truncation logic needed.
The title cap (90 chars, `src/lib/ewcNewsContent.js:1`) fits within Discord's
embed title limit of 256. The cover image maps to `EmbedBuilder.setImage()`.
The "Read more" URL is `${config.dashboard.publicUrl}/games/{gameSlug}/news/{id}`
(route confirmed at `apps/web/src/app/games/[slug]/news/[id]/page.tsx`).

**Bilingual handling — two options (operator decides):**

| Option | Description |
|---|---|
| A — AR primary + EN in footer (RECOMMENDED for this community) | Arabic title + summary in the embed body; English title + summary in the embed footer or a second field. Respects the community's primary language (Arabic-first throughout the dashboard). |
| B — One message per locale, posted in sequence | Two messages; doubles noise; not recommended. |

Recommendation A: for `contentMode = "translated"` posts, put the AR translation
as the embed title/description and add an `EN` field with the English translation.
For `contentMode = "shared"` posts, use the single translation as-is and note the
locale in the footer.

---

### Decision 4 — Lifecycle: store message ID, edit on update, delete on unpublish/delete (RECOMMENDED)

**Options**

| Event | v1 Recommendation |
|---|---|
| Initial post | Send embed → store `(post_id, channel_id, message_id)` in `ewc_news_discord_posts` |
| Edit (content change while status = "published") | Fetch message by stored `message_id` → `msg.edit(newEmbed)` |
| Unpublish (status → "draft") | Fetch message → `msg.delete()` → delete row from `ewc_news_discord_posts` |
| Delete post | Same as unpublish — delete Discord message, delete side-table row |

**Failure mode: message was manually deleted from Discord**

`channel.messages.fetch(messageId)` returns null/throws when the message is
gone. The job must catch this, log a warning (matching the pattern at
`src/jobs/ewcPredictions.js:181`), and remove the stale `ewc_news_discord_posts`
row so the next poll re-posts. This is the only meaningful failure mode for v1
and it is self-healing.

**Why not "re-post on every edit"?** Repeated sends create channel noise.
Editing the existing message keeps the post in its original position in the
channel timeline, which is what community members expect for corrections.

---

## v1 Schema + module touch list

### New side table

```sql
CREATE TABLE IF NOT EXISTS ewc_news_discord_posts (
  post_id    INTEGER NOT NULL PRIMARY KEY REFERENCES ewc_news_posts(id) ON DELETE CASCADE,
  guild_id   TEXT    NOT NULL,
  channel_id TEXT    NOT NULL,
  message_id TEXT    NOT NULL,
  posted_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

One row per post (single-guild deployment; `ON DELETE CASCADE` so a post delete
auto-cleans this table too). Added as a `db.exec(CREATE TABLE IF NOT EXISTS …)`
block in `src/db/index.js`, following the existing pattern at lines 97-140.

**Why side table, not columns on `ewc_news_posts`?**
- `ewc_news_posts` is shared between the web app and the bot. Adding Discord-
  specific columns to it leaks bot concerns into the web DB model.
- `ON DELETE CASCADE` handles cleanup automatically.
- The web's `listAdminNewsPosts()` and `listPublishedEwcNewsPosts()` calls do not
  need to know about Discord state — keeping the join optional.
- If per-guild fan-out is added later (Option B in Decision 2), the side table
  naturally extends to `PRIMARY KEY (post_id, guild_id)`.

### Settings column

Add `ewc_news_channel_id TEXT` to the `ensureColumns('guild_settings', […])`
call at `src/db/index.js:68-88`.

### Files a build plan would touch

| File | Change | Rough lines |
|---|---|---|
| `src/db/index.js` | `CREATE TABLE ewc_news_discord_posts`; add `ewc_news_channel_id` to `ensureColumns` | ~12 |
| `src/db/ewcNewsDiscord.js` (new) | `getUnpostedPublishedPosts()`, `recordDiscordPost()`, `updateDiscordPost()`, `deleteDiscordPost()`, `getDiscordPost(postId)` | ~60 |
| `src/db/settings.js` | `setEwcNewsChannel(guildId, channelId)` | ~10 |
| `src/jobs/ewcNews.js` (new) | `runEwcNewsSync(client)`, `startEwcNews(client)`, `stopEwcNews()` — poll, build embed, post/edit/delete, error handling | ~100 |
| `src/index.js` | Import `startEwcNews`, `stopEwcNews`; wire into startup and shutdown | ~6 |
| `src/config.js` | `ewcNews.refreshMinutes` from `EWC_NEWS_REFRESH_MINUTES` (default 2) | ~3 |
| `src/commands/set_channel.js` OR new `src/commands/set_news_channel.js` | Add `news` subcommand or new command; calls `setEwcNewsChannel`; audit log | ~40 |
| **Total** | | **~231 lines** |

---

## Effort estimate

| Sub-task | Size | Notes |
|---|---|---|
| Schema: side table + settings column | S | ~12 lines in `index.js` |
| DB module (`ewcNewsDiscord.js`) | S | ~60 lines, simple CRUD |
| Posting job (`ewcNews.js`) | M | Embed build, poll loop, edit/delete paths, error handling |
| Admin config command (news subcommand) | S | ~40 lines, follows `set_channel.js` pattern exactly |
| Edit/delete propagation (job paths) | M | Requires careful fetch-then-catch; test against manually-deleted messages |
| **Total** | **M** | Splits cleanly into 2 build plans (see below) |

**Suggested split for build plans:**
- Build Plan A (S–M): schema + `ewcNewsDiscord.js` + `ewcNews.js` for initial
  posting only (no edit/delete). Bot polls → sends new posts.
- Build Plan B (M): edit/delete propagation, including the self-healing re-post
  path when a Discord message has been manually removed.

**Prerequisite notes (for the build plans):**
- Plan 014's tests protect `ewcNewsPosts.js` — run them before and after any
  additions to that module.
- Plan 012's caps (`NEWS_TITLE_MAX_LENGTH = 90`, `NEWS_SUMMARY_MAX_LENGTH = 180`,
  `src/lib/ewcNewsContent.js:1-3`) are what guarantee the embed fits without
  truncation. Do not raise those caps without re-checking the Discord limits.

---

## Open questions for the operator

**Q1 — Bilingual embed layout** (recommended answer: AR primary + EN as a named
embed field)

For translated posts, should the embed lead with Arabic (title + description in
AR, English in a field below) or show English first? The dashboard is Arabic-
first throughout; mirroring that in Discord keeps brand consistency. However, if
the announcement channel is used by English-speaking partners, English-first may
be preferable. Recommend: AR title/description, EN in a "English" embed field.

**Q2 — Channel scope at launch** (recommended answer: one shared channel)

Start with a single `ewc_news_channel_id` for all game news, or should the bot
route each game to a dedicated channel from day one? Per-game routing (e.g.
`#valorant-news`, `#tft-news`) is architecturally supported via the
`game_match_cards` side-table pattern but requires operators to configure each
channel. Recommend: one channel at launch; add per-game routing in a later plan
when the operator can assess demand per game.

**Q3 — Republish on unpublish/re-publish** (recommended answer: no — delete on
unpublish, re-post if published again)

If a post is unpublished and then re-published (corrections workflow), should
the Discord message be re-sent as a new message, or silently dropped? The
recommended behavior: delete the message on unpublish (so wrong info is gone
fast), then the polling job re-posts the corrected version when it is published
again. This means the second post lands at a new position in the channel
timeline. Is that acceptable?

**Q4 — `allowedMentions` on news posts** (recommended answer: `{ parse: [] }`)

Should news posts be allowed to ping roles or everyone? The existing announce
pattern uses `allowedMentions: { parse: [] }` (no pings) consistently
(`src/jobs/ewcPredictions.js:151-152`). Recommend: same for news; if an
operator wants an `@here` ping on major news, that should be a separate
opt-in setting, not the default.

---

## Explicit non-goals for v1

- **Discord Forum / Thread channels** — the single text-channel model is
  simpler and already used for all other bot announcements.
- **Scheduled / timed publishing** — the dashboard has no scheduled publish
  concept; Discord delivery inherits that limitation.
- **RSS / webhook bridges** — the bot's direct Discord.js channel send is
  sufficient and avoids external service dependencies.
- **Reaction / reply tracking** — no community engagement data is fed back
  to the web dashboard.
- **Multi-guild fan-out** — the bot is confirmed single-guild; the schema
  stores `guild_id` for forward compatibility but the v1 job targets one guild.
