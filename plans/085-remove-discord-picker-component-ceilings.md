# Plan 085: Remove Discord prediction picker component ceilings

> **Executor instructions**: Execute only the Discord picker work described
> here. Preserve owner gates, ephemeral replies, and current resolution rules.
> Stop if Discord's installed component API cannot represent the planned flow.
>
> **Drift check (run first)**: `git diff --stat 2301227..HEAD -- src/commands/ewc_predict.js src/lib/ewcGameTeams.js src/lib/ewcClubCache.js tests/ewcPickerEntry.test.mjs tests/ewcWeeklyPicks.test.mjs`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plan 082
- **Category**: bug
- **Planned at**: commit `2301227`, 2026-07-10

## Why this matters

The guided weekly picker renders only the first 12 configured games. There is
no current slash-option fallback, so game 13 and later cannot be picked. Large
participant fields are split into four optional select menus; when editing, the
old pick remains default-selected in one menu and the submit parser silently
takes the first selected menu, which can ignore a new choice made in a later
menu. The official 2026 schedule currently has at most four games per week, so
the game cap is latent, but large lobby/fighting participant fields already
exercise the multi-menu path.

## Current state

- `src/commands/ewc_predict.js:313-331` uses
  `round.games.slice(0, 12)` because each game consumes three V2 components.
- The registered `/ewc_predict weekly` command at lines 76-80 exposes only the
  optional week; game/team fallback reads later in `execute` are legacy code.
- `src/commands/ewc_predict.js:674-696` creates up to four independent select
  menus and marks the existing option as default.
- `src/commands/ewc_predict.js:639-644` returns the first non-empty select value,
  without detecting multiple selections or user intent.
- Components are owner-bound through custom IDs. Preserve that invariant on
  every page/modal.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `node --test tests/ewcPickerEntry.test.mjs tests/ewcWeeklyPicks.test.mjs tests/ewcPredictCommand.test.mjs` | all pass |
| Bot suite | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

## Scope

**In scope**:

- `src/commands/ewc_predict.js`
- Pure picker pagination/selection helpers extracted under `src/lib/` if useful
- `tests/ewcPickerEntry.test.mjs`
- `tests/ewcPredictCommand.test.mjs`
- Focused participant-choice tests in `tests/ewcWeeklyPicks.test.mjs`

**Out of scope**:

- Changing the official week schedule.
- Club/participant enrichment or Liquipedia rate behavior.
- Website pick forms.
- Prediction write atomicity; consume plan 082's service unchanged.
- Increasing Discord platform limits or depending on undocumented clients.

## Git workflow

- Branch: `advisor/085-paginate-discord-prediction-picker`
- Suggested commit: `fix: paginate the Discord prediction picker`
- Do not push or open a PR unless requested.

## Steps

### Step 1: Extract a pure page model

Create a pure helper that receives all round games, saved picks, page, and `now`
and returns a bounded page plus total pages. Choose a page size from the actual
V2 component budget, leaving headroom for header, week switcher, progress, and
Prev/Next controls. Do not hardcode a second unexplained `12`.

Custom IDs must include season, week, page, and owner while staying below
Discord's 100-character limit for generated official keys.

**Verify**: tests with 0, 1, 12, 13, 25, and 40 games prove every game appears
exactly once and page bounds clamp safely.

### Step 2: Render pagination without losing picker state

Add owner-gated Prev/Next controls that edit the same ephemeral message. Keep
the week switcher usable from every page. After a modal submission, return to
the page containing that game, not page one.

Show page number and overall completion from plan 084 when available. Dynamic
labels must not resize or shift the component layout.

**Verify**: component tests navigate first/middle/last pages and reject another
member's controls.

### Step 3: Make large participant selection unambiguous

Do not preselect the existing pick across independent optional menus. Display
the current pick in modal text instead. On submit:

- manual text still overrides selectors;
- exactly one selected option is accepted;
- zero selections returns the existing actionable error;
- more than one selected option returns an explicit error and writes nothing.

If the installed Discord modal API makes optional selects submit defaults in a
different way, encode that observed behavior in a pure parser fixture rather
than guessing.

**Verify**: tests cover an existing pick in chunk 1 changed to chunk 2, multiple
selections, manual override, and unchanged current pick.

### Step 4: Remove unreachable legacy input handling

After confirming the deployed command definition has no `game`/`team` options,
remove or isolate the unreachable direct-option branch and autocomplete cases.
Do not re-add confusing slash options merely to preserve dead code. If Discord
deployment intentionally retains those options for backward compatibility,
stop and report instead.

**Verify**: command-definition tests assert the intended weekly options and all
registered autocomplete paths are reachable.

### Step 5: Run all gates and component acceptance

Run the full command table. In a test guild, verify a 13-game fixture page, a
40-participant modal, edit across chunks, owner gating, and expiry/error states.
No test may query Liquipedia.

## Test plan

- Extend the recursive component finder pattern in
  `tests/ewcPickerEntry.test.mjs`.
- Add pure tests for page partitioning and selected-value parsing.
- Use DB fixtures for participant choices; do not mock platform limits away.
- Assert no game is silently omitted and no ambiguous modal writes.

## Done criteria

- [ ] All configured games are reachable regardless of round size.
- [ ] Editing a pick across choice chunks stores the new choice.
- [ ] Ambiguous multi-select submissions write nothing and explain the problem.
- [ ] Pagination remains ephemeral and owner-gated.
- [ ] Week switching and completion state work on every page.
- [ ] All required repo checks pass.

## STOP conditions

- The installed discord.js version cannot paginate Components V2 messages.
- Generated official custom IDs exceed Discord limits even after compact,
  reversible encoding.
- Legacy direct game/team slash options are still intentionally deployed and
  relied upon by members.

## Maintenance notes

Future official schedules must not introduce another fixed game cap. Keep page
size derived from one named component-budget constant and test the boundary
whenever picker header/actions gain components.

