# Plan 103: Add a personal match calendar with iCal export

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. If a STOP condition occurs, stop and
> report; do not improvise.
>
> **Drift check**: `git diff --stat 27a04f8..HEAD -- src/db/userFollows.js src/db/matches.js apps/web/src/components/dashboard/account-workspace.tsx apps/web/src/lib/follows.ts apps/web/src/lib/i18n.ts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/097-add-today-for-you-overview.md recommended
- **Category**: direction
- **Planned at**: commit `27a04f8`, 2026-07-17

## Why this matters

People follow teams, games, and tournaments because they want to know when to
watch. A personal calendar turns existing follows into a practical schedule and
lets users subscribe from Apple Calendar, Google Calendar, Outlook, or any
calendar client.

## Current state

- `src/db/userFollows.js` stores follow rows and already knows how to match
  follow keys against match entities through `listFollowerIdsForMatch`.
- `src/db/matches.js` stores scheduled matches in unix seconds UTC.
- `/me` already has account tabs and authenticated API routes under
  `apps/web/src/app/api/me`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `npm --workspace @esports-community-bot/web run test -- match-calendar` | all pass |
| Bot tests | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- `src/db/userFollows.js` only for a bounded viewer schedule helper.
- `apps/web/src/lib/match-calendar.ts` (create)
- `apps/web/src/app/api/me/calendar/route.ts` (create JSON endpoint)
- `apps/web/src/app/api/me/calendar/ics/route.ts` (create iCal endpoint)
- `apps/web/src/components/dashboard/match-calendar-panel.tsx` (create)
- `apps/web/src/components/dashboard/account-workspace.tsx`
- `apps/web/src/lib/i18n.ts`
- tests under `apps/web/src/test/`

**Out of scope**:
- Public calendars for anonymous visitors.
- New notification/reminder delivery.
- External calendar OAuth integrations.
- Provider fetchers.

## Steps

### Step 1: Add the schedule projection

Build a helper that accepts a Discord user ID and returns upcoming matches for
followed games, tournaments, teams, and players in the next 30 days. Deduplicate
matches that match several follows. Cap to 200 rows.

**Verify**: DB tests cover all follow types, duplicate follows, no follows, and
the 30-day cap.

### Step 2: Add JSON and iCal endpoints

Add authenticated endpoints under `/api/me/calendar`. The iCal route must return
`text/calendar; charset=utf-8`, use UTC times, include stable UIDs based on match
IDs, and escape text according to RFC 5545 basics.

**Verify**: tests parse the response text and assert `BEGIN:VCALENDAR`,
`BEGIN:VEVENT`, `UID`, `DTSTART`, `DTEND`, and escaped summaries.

### Step 3: Add the account panel

Add a "Calendar" panel or card in `/me` that shows upcoming followed matches,
"Add to calendar" links for single matches, and a copyable/subscribable `.ics`
feed URL. Use `LocalDateTime` for display so visitors see their local time.

**Verify**: web test renders the panel in empty and populated states.

## Test plan

- Unit tests for iCal escaping and UTC formatting.
- API tests for unauthenticated 401 and authenticated success.
- Dashboard component test if the repo has a component test harness; otherwise
  cover the route projection and add manual QA instructions.

## Done criteria

- [ ] Authenticated users can download a valid `.ics` feed.
- [ ] Calendar rows match follows and are deduped.
- [ ] No private Discord fields appear in the public calendar text beyond the
      authenticated user's own schedule semantics.
- [ ] Full repo verification passes.

## STOP conditions

- There is no reliable authenticated Discord user in the route context.
- Calendar generation would require new DB secrets or external calendar APIs.

## Maintenance notes

If match reminders are added later, reuse the same schedule projection instead
of creating a second follow-to-match implementation.
