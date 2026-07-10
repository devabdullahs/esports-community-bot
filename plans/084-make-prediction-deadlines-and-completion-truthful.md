# Plan 084: Make prediction deadlines and completion truthful

> **Executor instructions**: Follow this plan exactly and run every gate. This
> plan adds reminder persistence, so dual-backend schema parity is mandatory.
> Stop on any listed condition rather than weakening idempotency or rate limits.
>
> **Drift check (run first)**: `git diff --stat 2301227..HEAD -- src/jobs/ewcPredictions.js src/commands/ewc_predict.js src/db/ewcPredictions.js src/db/index.js scripts/postgres/schema.sql src/db/settings.js src/config.js .env.example apps/web/src/lib/ewc-profile-sync.ts apps/web/src/components/dashboard/profile-dashboard.tsx`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plan 083
- **Category**: bug
- **Planned at**: commit `2301227`, 2026-07-10

## Why this matters

Each weekly game locks independently, but the opening announcement says that
"picks close" at the round's final lock. The web profile likewise emphasizes
`close_at`, not the next game deadline. A read-only production audit found that
Week 1 had seven participants but only four complete submissions; all three
incomplete members started while their missing games were still open. Members
need truthful next-deadline messaging, visible completion, and one restrained,
idempotent reminder before a game locks.

## Current state

- `src/jobs/ewcPredictions.js:312-321` lists game names without lock times and
  renders one `round.close_at` line.
- `src/commands/ewc_predict.js:304-355` shows each game's lock correctly but has
  no `picked/total` summary or all-complete state.
- `src/commands/ewc_predict.js:968-976` announces participation after the first
  pick with wording that implies the week is complete.
- `apps/web/src/lib/ewc-profile-sync.ts:119-135` calculates remaining open game
  keys but exposes only a generic Discord guild URL.
- `src/jobs/ewcPredictions.js:233-255` maintains a persistent leaderboard
  message that already contains an `Open my picks` button; settings store its
  channel/message IDs.
- `ewc_prediction_weeks.open_announced_at` dedupes only the initial opening
  announcement. Do not overload it for per-game reminders.
- Discord sends use `allowedMentions: { parse: [] }` by default. Preserve that
  no-ping behavior unless a future explicit opt-in role feature is approved.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused bot tests | `node --test tests/ewcPredictionReminders.test.mjs tests/ewcPickerEntry.test.mjs tests/ewcPredictionLifecycle.test.mjs` | all pass |
| Focused web tests | `npm --workspace @esports-community-bot/web run test -- src/test/ewc-sync.test.ts` | all pass |
| Bot suite | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

## Scope

**In scope**:

- `src/lib/ewcPredictionRounds.js` completion helpers from plan 083
- `src/jobs/ewcPredictions.js`
- `src/commands/ewc_predict.js`
- `src/db/ewcPredictions.js`
- `src/db/index.js` and `scripts/postgres/schema.sql`
- `src/config.js` and `.env.example`
- `apps/web/src/lib/ewc-profile-sync.ts`
- `apps/web/src/components/dashboard/profile-dashboard.tsx`
- Prediction copy in `apps/web/src/lib/i18n.ts`
- `tests/ewcPredictionReminders.test.mjs` (new) and focused tests

**Out of scope**:

- Discord DMs, role pings, or extending generic website notification types.
- Web pick submission.
- Scoring/ranking changes.
- More frequent Liquipedia fetching.

## Git workflow

- Branch: `advisor/084-truthful-prediction-deadlines`
- Suggested commit: `fix: clarify prediction deadlines and completion`
- Do not push or open a PR unless requested.

## Steps

### Step 1: Add a shared completion projection

Add a pure helper alongside plan 083's actionable-round model. Given a round,
the viewer's picks, and `now`, return:

- `pickedGames`, `totalGames`, and `isComplete`;
- open-unpicked games ordered by `lockAt`;
- locked-unpicked games (`missedGames`);
- `nextLockAt` and `finalLockAt`;
- a display-safe game/event label for each item.

Match picks by game key and ignore stale keys. Never include another member's
pick values in a public projection.

**Verify**: pure tests cover empty, partial, complete, stale-key, and missed
states plus independent locks.

### Step 2: Make Discord opening and picker copy accurate

Change the opening announcement to state that games lock independently. List
each game's lock time (or `TBD`) and emphasize the next lock rather than saying
all picks close at the round's final lock. Bound content to Discord limits;
split into at most two messages only if necessary.

In the private picker header, show `X/Y picked`, the next deadline, a success
state when complete, and a warning for missed games. Change the first-pick
public announcement from "locked in"/"is in" to unambiguous "started picks";
do not announce publicly for every subsequent pick.

**Verify**: builder tests assert exact completion states and that opening copy
contains every configured game lock in a four-game round.

### Step 3: Add idempotent per-game reminder persistence

Add an `ewc_prediction_reminders` table to both schemas with a primary/unique
key covering `guild_id`, `week_id`, `game_key`, and `kind`, plus `sent_at`.
Use explicit `REFERENCES ... ON DELETE CASCADE` where supported by the existing
schema conventions. Add DB helpers that claim/mark a reminder transactionally;
two overlapping automation runs must not both send it.

Add documented config:

- `EWC_PREDICTIONS_REMINDERS_ENABLED` (default true)
- `EWC_PREDICTIONS_REMINDER_HOURS` (default 6, clamp 1-24)

Do not store a global in-memory sent set; reminders must survive restarts.

**Verify**: schema tests initialize SQLite, and static schema parity checks find
the table/columns in `scripts/postgres/schema.sql`.

### Step 4: Send one bounded, no-ping reminder

During prediction automation, identify games entering the configured reminder
window. Only remind when the game is still open and at least one existing week
participant has not picked it. The message should contain game/event, exact and
relative lock time, incomplete participant count (not identities), and the
standard command. Use `allowedMentions: { parse: [] }`.

Claim/send/finalize semantics must avoid duplicates without permanently losing
a reminder when Discord send fails. Use a short lease/attempt state if a simple
claim cannot distinguish failed sends; do not stamp success before delivery.

**Verify**: tests cover restart/idempotency, overlapping runs, no incomplete
participants, failed send retry, disabled config, and already locked games.

### Step 5: Deep-link website users to the picker message

When leaderboard channel and message settings exist, return
`https://discord.com/channels/<guild>/<channel>/<message>` from the private
profile projection. Fall back to the guild URL only when the message is absent.
Update profile UI to label the action `Open my picks`, show next lock, complete,
and missed states from the shared projection.

Do not expose private channel/message configuration through the unauthenticated
public prediction status unless it is already intentionally public.

**Verify**: API tests cover configured and fallback URLs and ensure no raw picks
appear in the response.

### Step 6: Run all gates and inspect the migration

Run every command above. Initialize a fresh SQLite DB and inspect the generated
schema. If a disposable Postgres database is available, run schema creation and
the reminder helper tests there; never test against production.

## Test plan

- Model automation tests with a fake Discord channel and fixed `now`; no real
  timers or network calls.
- Add a production-shaped four-game round with staggered locks.
- Prove a failed Discord send remains retryable and a successful send remains
  deduped across process restarts.
- Extend web API tests for completion and deep-link projection.

## Done criteria

- [ ] No member-facing copy implies all games share the last lock time.
- [ ] Picker and web profile distinguish incomplete, complete, and missed picks.
- [ ] One reminder per game is durable, retryable, and no-ping.
- [ ] Direct Discord action opens the persistent picker message when configured.
- [ ] SQLite and Postgres schemas remain equivalent.
- [ ] All required repo checks pass.

## STOP conditions

- Reliable retry requires sending while a DB transaction is open.
- The predictions channel cannot accept components/message links under current
  Discord permissions.
- A schema migration would require rebuilding an unrelated notification table.
- Plan 083 did not provide a stable multi-round completion projection.

## Maintenance notes

Keep reminder delivery separate from match notifications until product owners
explicitly approve prediction DMs/preferences. If automation frequency changes,
tests must still prove the reminder window cannot be skipped.

