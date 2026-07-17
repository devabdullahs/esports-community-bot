# Plan 098: Let members manage follows from Discord

> **Executor instructions**: Follow this plan exactly. Discord component input
> is untrusted even when a message is ephemeral; resolve every target from the
> local database and always mutate `interaction.user.id`, never an ID encoded by
> the client. The reviewer owns `plans/README.md`; do not update roadmap files
> in this implementation.
>
> **Mandatory dependency gate (run before drift check)**: Plan 094 must have an
> approved review verdict and its browser harness must be in the branch base:
> `apps/web/e2e/` exists and `npm run web:e2e -- --list` succeeds. If either is
> false, STOP and report the dependency; do not create a parallel E2E setup.
>
> **Drift check (run second)**: `git diff --stat 1530ee8..origin/main -- src/commands src/events/interactionCreate.js src/lib/commandRegistry.js src/db/userFollows.js src/db/matches.js src/db/tournaments.js src/db/teams.js src/db/players.js tests`.
> Stop if component routing or follow key semantics changed materially.

## Status

- **Priority**: P2
- **Effort**: M-L
- **Risk**: MED
- **Depends on**: Plan 094
- **Category**: direction / feature
- **Planned at**: commit `1530ee8`, 2026-07-14

## Why this matters

Following games, tournaments, teams, and players already drives website inbox
and Discord DM notifications, but users can only manage it on the website.
Discord is where match discovery happens, so the feature is hard to discover
at the moment of intent. A first-class `/follow` command and contextual match
action make the existing notification system useful without creating a second
subscription store.

## Current state

- `src/db/userFollows.js` is the only source of truth. It supports
  `game`, `tournament`, `team`, and `player`; normalizes keys, makes upsert
  idempotent, and enforces `MAX_FOLLOWS_PER_USER = 200` transactionally.
- Key semantics are fixed: game slug, tournament ID text, normalized team name,
  and player ID text. Preserve them exactly.
- `src/events/interactionCreate.js` routes component custom IDs by the prefix
  before `:` to a command's `handleComponent`/`handleModal`.
- `src/commands/match.js` returns an ephemeral match card but has no follow
  action. `src/commands/lookup.js` searches Liquipedia directly and does not
  establish a trusted local team/player identity; do not add unsafe follow
  writes to lookup results.
- The bot serves one configured guild and rejects foreign-guild interactions
  before dispatch. Keep `.setContexts(InteractionContextType.Guild)`.
- Discord autocomplete and select menus return at most 25 choices. Every label
  and custom ID must respect Discord length limits.

## Command contract

Create `/follow` with subcommands:

```text
/follow game       game:<local game autocomplete>
/follow tournament tournament:<active tracked tournament autocomplete>
/follow team       team:<local team autocomplete> game:<optional filter>
/follow player     player:<local player autocomplete> game:<optional filter>
/follow remove     follow:<the caller's current follows autocomplete>
/follow list
```

All replies are ephemeral. Add one "Follow..." select to `/match` with the
tracked tournament and non-placeholder teams. The select is omitted when no
valid target exists. `/follow list` paginates at 10 rows and provides remove
controls plus an external link button to `/me?tab=following`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `node --test tests/followCommand.test.mjs tests/followNotifications.test.mjs tests/interactionRouting.test.mjs` | all pass |
| Bot tests | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Native typecheck | `npm --workspace @esports-community-bot/web run typecheck:native` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- `src/commands/follow.js` (create)
- `src/commands/match.js`
- `src/db/userFollows.js` only for bounded caller-follow pagination if needed
- existing local game/tournament/team/player DB modules for bounded autocomplete
- `src/lib/followComponents.js` (create only if pure builders keep the command testable)
- `tests/followCommand.test.mjs` (create)
- `tests/followNotifications.test.mjs` only for interoperability assertions
- `tests/interactionRouting.test.mjs` only if generic routing needs a
  regression assertion
- `.env.example` only if the existing dashboard public URL is undocumented

**Out of scope**:
- Following arbitrary Liquipedia search results.
- New tables, follow types, notification types, or scoring behavior.
- Admin-created follows or following another member's account.
- Public/non-ephemeral follow lists.
- Sending a DM immediately when a follow is created.

## Git workflow

- Work only in a separate `git worktree` (or clean clone) whose base contains
  the approved Plan 094 commit. The reviewer will name that commit/ref in the
  execution handoff; verify it with `git merge-base --is-ancestor <094-commit>
  HEAD` before editing. Branch from that ref as `codex/098-discord-follows`.
  Never build, test, commit, stash, clean, reset, or checkout in the dirty
  operator checkout.
- Commit example: `feat(discord): add follow management command`.
- Run command deployment only in the operator's deployment process; do not
  deploy commands from a development machine without instruction.

## Steps

### Step 1: Add trusted, bounded autocomplete resolvers

Implement local-only resolvers for each entity type. Validate the focused
subcommand and option before querying. Return active tracked tournaments for
the configured guild; teams/players from local directories with optional game
filter; games from the existing local game list; remove choices only from
`listFollowsForUser(interaction.user.id)`. Search case-insensitively, cap DB
candidates and Discord response to 25, slice labels to 100 characters, and use
only stable IDs/keys as values.

**Verify**: focused tests cover each type, unknown autocomplete input returns
`[]`, 25 cap, another user's follows never appear, and no Liquipedia client is
called.

### Step 2: Resolve and upsert the canonical local entity

For each add subcommand, resolve the supplied value again server-side. Build
canonical `entityLabel` and website `entityRef`; reject missing, archived, wrong
game, or foreign-guild records. Call `upsertFollow` with
`discordUserId: interaction.user.id`. Report already-followed success without a
duplicate and show the 200-follow quota as an actionable error with the manage
link.

Never trust an autocomplete label, custom ID label, or caller-provided team
name as the stored canonical entity.

**Verify**: tests cover valid add for four types, idempotent add, invalid ID,
archived/foreign tournament, quota, and normalized team key.

### Step 3: Implement list, pagination, and remove

Render at most 10 follows per page in an ephemeral embed. Use component custom
IDs prefixed `follow:` and encode only action/page/stable row ID or type/key
within Discord's limit; resolve ownership at handling time. Page and remove
controls must compare `interaction.user.id` to the original owner encoded in a
signed/opaque server-side-safe way or, preferably, rely on ephemeral ownership
plus re-query and always mutate the clicker's own rows. A stale remove becomes
an idempotent "already removed" result. Disable page controls at boundaries.

**Verify**: tests cover 0/1/11/200 follows, stale page, stale remove, forged
row/key, and a second user clicking a copied component cannot remove the first
user's follow.

### Step 4: Add the contextual match select

After `buildMatchCardPayload`, append a String Select row labeled "Follow..."
without replacing existing card attachments/embeds. Options: tournament,
team A, team B, excluding placeholders and duplicates. Custom ID includes the
match DB ID only. `follow.handleComponent` reloads the match and tournament,
maps selected enum values to canonical local entities, and writes for the
clicking user. Do not encode raw team names in custom IDs or option values.

**Verify**: tests cover a normal match, placeholder/lobby match, archived
tournament, stale match, forged option, and existing follow.

### Step 5: Add safe bilingual responses and website handoff

Use concise EN/AR copy selected using the repository's Discord locale policy
or established command convention. Do not attempt unsupported Discord command
metadata locale `ar`. Include a link button to the localized website following
tab when `config.dashboard.publicUrl` is valid. All replies remain ephemeral
and no allowed mention is enabled.

**Verify**: payload tests assert ephemeral flags, no mention content, valid
button URLs, and Discord component limits.

### Step 6: Run full gates and deployment serialization check

Run every command in the table. Import the command data in a test and call
`toJSON()` to prove Discord accepts the shape. Command discovery is automatic:
`src/lib/commandRegistry.js` uses `loadModules(join(srcDir, 'commands'))` and
collects every module exporting `data`; do not add a manual registry or edit a
nonexistent `src/deploy-commands.js`. Extend the command-registry test (or add
one beside the command tests) to assert `follow.js` is included by
`collectCommandJson()` and no command-count assumption breaks.

## Test plan

- Add `tests/followCommand.test.mjs` with mocked interactions and disposable DB.
- Extend `tests/interactionRouting.test.mjs` only if the generic route needs a
  regression assertion; do not special-case follow in the router.
- Keep `tests/followNotifications.test.mjs` proving follows created by Discord
  fan out identically to website-created rows.

## Done criteria

- [ ] Four local entity types can be followed and existing rows removed/listed.
- [ ] All writes use the clicking user's ID and a server-resolved canonical
      entity.
- [ ] Match actions contain no raw team name in custom IDs.
- [ ] Autocomplete/select/page limits satisfy Discord constraints.
- [ ] Replies are ephemeral and never mention users/roles.
- [ ] Existing follow notification tests and all repository gates pass.

## STOP conditions

- A requested entity can only be resolved through a live Liquipedia call.
- The match payload already uses five component rows and no safe row is free.
- Component ownership would require storing a bearer secret in custom IDs.
- Supporting Arabic command metadata would require an unsupported Discord
  locale enum.
- Follow key semantics changed since the planned commit.

## Maintenance notes

Discord and web must continue sharing `user_follows`; do not fork state. When a
fifth entity type is added, update normalization, website API, Discord command,
fan-out matching, and tests in one change. Review component handlers for stale
records and ownership, not just the happy-path slash execution.
