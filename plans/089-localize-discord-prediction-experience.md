# Plan 089: Localize the complete Discord prediction experience

> **Executor instructions**: Centralize copy instead of sprinkling locale
> conditionals through the command. Do not translate canonical team, player,
> game, or tournament names. Preserve custom IDs and state semantics.
>
> **Drift check (run first)**: `git diff --stat 2301227..HEAD -- src/commands/ewc_predict.js src/jobs/ewcPredictions.js src/lib/ewcPredictionLeaderboardCard.js tests/ewcPickerEntry.test.mjs tests/ewcPredictCommand.test.mjs`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans 084, 085, and 087
- **Category**: direction
- **Planned at**: commit `2301227`, 2026-07-10

## Why this matters

The community is Gulf-based and the website is bilingual, but the private
Discord picker, modal labels, errors, leaderboard controls, and most command
metadata are English-only. Arabic currently exists mainly in the guide/link
embeds and optional share card. Localizing the interaction itself reduces the
need to read a long guide and keeps Discord and website terminology aligned.

## Current state

- `src/commands/ewc_predict.js:73-143` defines English command/subcommand/option
  descriptions without Discord localizations.
- `src/commands/ewc_predict.js:304-355` hardcodes English picker headings,
  statuses, labels, and week-switch copy.
- `src/commands/ewc_predict.js:647-714` hardcodes modal and error text.
- `src/commands/ewc_predict.js:1128-1188` explicitly supports Arabic only for
  share-card content.
- `src/commands/ewc_predict.js:1195-1228` contains bilingual guide/link prose,
  proving established Arabic terminology but not a reusable dictionary.
- Channel announcements have no individual interaction locale, so they need a
  concise bilingual or single-guild configured presentation.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `node --test tests/ewcPredictionLocale.test.mjs tests/ewcPickerEntry.test.mjs tests/ewcPredictCommand.test.mjs` | all pass |
| Bot suite | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

## Scope

**In scope**:

- `src/lib/ewcPredictionCopy.js` (new)
- `src/commands/ewc_predict.js`
- `src/jobs/ewcPredictions.js`
- Prediction-card text in `src/lib/ewcPredictionLeaderboardCard.js` only if the
  locale is explicitly selected/configured
- Focused locale/component tests

**Out of scope**:

- Translating canonical entity names or raw Liquipedia data.
- Localizing unrelated bot commands.
- Changing scoring, picker state, reminders, or ranking behavior.
- Machine translation or runtime external translation APIs.

## Git workflow

- Branch: `advisor/089-localize-discord-predictions`
- Suggested commit: `feat: localize Discord prediction flows`
- Do not push or open a PR unless requested.

## Steps

### Step 1: Establish locale resolution and vocabulary

Create a small locale resolver that maps Discord Arabic locale variants to
`ar` and everything else to `en`. Build `ewcPredictionCopy.js` with typed-by-
tests keys for command errors, picker states, progress/deadlines, modal labels,
leaderboards, profile/details, link/sync, and reminders.

Reuse website/guide concepts consistently: prediction, weekly round, season
pick, locked, missed, points, rank, weekly win, and exact-rank bonus. Keep
Discord timestamps and canonical entity names LTR-safe inside Arabic text.

**Verify**: dictionary parity test fails if either locale misses a key or a
function returns over platform limits.

### Step 2: Localize registered command metadata

Use discord.js command/option localization APIs for Arabic descriptions and
choice names where supported. Keep stable English command/subcommand option
identifiers so existing interactions/custom IDs continue working. If Discord
does not allow Arabic slash command names in the installed API, localize
descriptions only; do not invent unsupported aliases.

**Verify**: command JSON tests assert English defaults, Arabic localizations,
stable identifiers, and Discord length constraints.

### Step 3: Localize private interactions by invoking-user locale

Pass locale explicitly into picker/profile/details builders from
`interaction.locale`. Replace hardcoded labels, statuses, errors, modal copy,
pagination, completion, lock messages, and buttons with dictionary values.
Avoid module-global locale state because interactions run concurrently.

**Verify**: the same fixture renders English and Arabic JSON with identical
custom IDs, disabled state, pick values, and counts.

### Step 4: Make public channel messages compactly bilingual

Opening, reminder, participation, and scoring announcements have no user
locale. Render Arabic and English in one bounded message, with Arabic first for
the community. Share the same data projection so game lists/deadlines are not
duplicated or inconsistent. Keep `allowedMentions: { parse: [] }`.

If messages exceed Discord limits, shorten prose; do not split every event into
spammy duplicate language messages.

**Verify**: four-game opening/reminder/scoring fixtures stay within limits and
contain both languages without duplicate pings.

### Step 5: Verify directionality and live Discord behavior

Use Unicode isolation or formatting boundaries only where needed around LTR
team names, numbers, URLs, and commands. Test on Discord desktop and mobile;
ensure buttons/selects remain in logical order and long mixed-script labels fit.

**Verify**: live test-guild acceptance covers English and Arabic client locales,
week switching, modal error, details, leaderboard pagination, and reminders.

### Step 6: Run all gates and remove obsolete duplicated prose

Run all commands. Remove only prediction prose now represented by dictionary
keys; retain long guide content where it provides rules rather than UI copy.

## Test plan

- New locale parity, command JSON, component JSON, mixed-direction, and platform
  length tests.
- Existing picker tests continue to assert semantics independent of copy.
- No snapshots of entire large embeds; assert meaningful keys/sections.

## Done criteria

- [ ] Slash metadata exposes Arabic descriptions without changing identifiers.
- [ ] Every member-facing prediction interaction has English and Arabic copy.
- [ ] Private UI follows the invoking user's locale.
- [ ] Public announcements are bounded, bilingual, and no-ping.
- [ ] Canonical names remain unchanged and mixed-direction text is readable.
- [ ] All required repo checks pass.

## STOP conditions

- Discord localization APIs in the installed version differ from the generated
  command deployment path.
- Locale propagation would require module-global mutable state.
- Bilingual public messages cannot fit bounded content without omitting game
  deadlines or scoring outcomes.

## Maintenance notes

Any new prediction interaction must add copy keys and parity tests in the same
change. Keep canonical entity data outside translation dictionaries.

