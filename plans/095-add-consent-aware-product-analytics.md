# Plan 095: Add consent-aware, privacy-safe product analytics

> **Executor instructions**: Execute each step and verification in order. This
> is analytics, not surveillance: reject any implementation that adds account
> IDs, free-form text, search terms, article titles, team names, query strings,
> or other user-provided values to analytics. Update the roadmap row when done
> unless a reviewer owns it.
>
> **Mandatory dependency gate (before drift check)**: Do not begin this plan
> until Plan 094 has an approved review verdict and its browser baseline has
> landed in the execution branch. If it is not approved, STOP and report the
> dependency; do not implement a parallel analytics harness.
>
> **Drift check (run second)**: `git diff --stat 1530ee8..origin/main -- apps/web/src/components/analytics apps/web/src/app/api/analytics apps/web/src/app/admin/analytics apps/web/src/lib/google-analytics.ts apps/web/src/lib/web-analytics.ts src/db/webAnalytics.js src/db/index.js src/jobs scripts/postgres/schema.sql scripts/migrate-sqlite-to-postgres.mjs apps/web/src/lib/i18n.ts`.
> Compare any changed ingestion, consent, or schema code with this plan before
> proceeding. Stop on a contract mismatch.

## Status

- **Priority**: P1
- **Effort**: M-L
- **Risk**: MED
- **Depends on**: Plan 094
- **Category**: direction / analytics
- **Planned at**: commit `1530ee8`, 2026-07-14

## Why this matters

The dashboard measures visits and engagement but cannot answer whether users
actually submit predictions, follow entities, configure notifications, use
multiview, or leave for Discord/source links. Without conversion events,
product decisions are based on page traffic rather than completed user goals.
This plan adds a deliberately small event vocabulary while preserving the
existing opt-in consent and Global Privacy Control behavior.

## Current state

- `apps/web/src/components/analytics/analytics-tracker.tsx` accepts only
  `eventType: "pageview" | "engagement"`, strips query strings, blocks private
  paths, and sends only after consent is `granted` and GPC is false.
- `apps/web/src/app/api/analytics/event/route.ts` enforces a 2 KiB streaming
  body cap, same-site browser requests, bot/DNT/GPC rejection, strict visitor
  IDs, source and campaign allowlists, path cleaning, and two rate limits.
  Preserve every one of these controls.
- `src/db/webAnalytics.js` accepts only pageview/engagement and computes the
  admin dashboard from `web_analytics_events`.
- `apps/web/src/components/analytics/google-analytics-consent.tsx` loads GA4
  only after explicit consent. Advertising storage and personalization remain
  denied; page views use `send_page_view: false` plus explicit events.
- SQLite schema lives in `src/db/index.js`; Postgres parity lives in
  `scripts/postgres/schema.sql`. Use `$1` placeholders through shared DB
  helpers and keep both backends equivalent.
- The admin UI is `apps/web/src/app/admin/analytics/page.tsx`; use existing
  shadcn/Base UI cards, tables, and chart wrappers rather than a new charting
  package.

The initial event allowlist is intentionally finite:

```text
prediction_submit
follow_create
follow_remove
notification_prefs_update
multiview_start
multiview_share
site_search_result_open
source_link_open
discord_join_click
```

An event name is the only feature dimension. Do not attach selected clubs,
search queries, entity names/IDs, Discord IDs, or arbitrary labels.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused bot tests | `node --test tests/webAnalytics.test.mjs` | all pass |
| Focused web tests | `npm --workspace @esports-community-bot/web run test -- analytics-event google-analytics-consent analytics-acquisition` | all pass |
| Bot tests | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Native typecheck | `npm --workspace @esports-community-bot/web run typecheck:native` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- `apps/web/src/components/analytics/analytics-tracker.tsx`
- `apps/web/src/components/analytics/google-analytics-consent.tsx`
- `apps/web/src/lib/google-analytics.ts`
- `apps/web/src/lib/product-analytics.ts` (create)
- `apps/web/src/app/api/analytics/event/route.ts`
- `apps/web/src/lib/web-analytics.ts`
- `src/db/webAnalytics.js`
- `src/db/index.js`
- `src/jobs/webAnalyticsRetention.js` (create)
- `src/index.js` (start/stop the retention job)
- `scripts/postgres/schema.sql`
- `scripts/migrate-sqlite-to-postgres.mjs`
- `apps/web/src/app/admin/analytics/page.tsx` and its existing child components
- `apps/web/src/lib/i18n.ts`
- Instrumentation call sites for the nine named actions only
- `tests/webAnalytics.test.mjs`
- analytics web tests under `apps/web/src/test/`

**Out of scope**:
- Advertising, remarketing, Google Signals, user-provided data, or enhanced
  conversions.
- Account-level or cross-device identity.
- Recording search terms, picks, followed entity IDs, stream handles, or URLs.
- Server-side success events for actions a browser did not initiate.
- A generic `track(name, properties)` API accepting arbitrary names/properties.

## Git workflow

- Work only in a separate `git worktree` (or clean clone) based on the branch
  containing approved Plan 094 work, using `codex/095-product-analytics`.
  Never commit from the dirty operator checkout, and never use `git clean`,
  `git stash`, reset, or checkout there.
- Commit example: `feat(web): add consent-aware product events`.
- Do not push unless instructed.

## Steps

### Step 1: Define one shared, closed product-event contract

Create `product-analytics.ts` with a literal tuple, derived TypeScript type,
runtime predicate, and a browser helper such as `trackProductEvent(name)`.
The helper must only dispatch a same-window custom event with an allowlisted
name. It must expose no properties argument. Give each dispatch an opaque,
browser-only event token; `AnalyticsTracker` owns a bounded in-memory set of
seen tokens and forwards each token once. Never send, store, or expose that
token in the API/database. Call sites own their separate responsibility: only
call the helper once after a confirmed mutation/action, never from an effect or
optimistic state transition. Unit-test acceptance of every known name and
rejection of unknown/injection strings.

**Verify**: focused web tests -> all allowlist tests pass.

### Step 2: Persist product events in a separate table

Do not weaken the CHECK constraint on the mature pageview table. Add
`web_product_events` to SQLite and Postgres with: integer id, visitor ID,
session ID, allowlisted event name, cleaned path, acquisition source, campaign,
country, and unix `occurred_at`. Add indexes for time and event name. Add DB
helpers to insert validated events and aggregate counts/unique sessions for a
selected period. Do not add user-agent or account IDs to the new table.

Use the repository's additive schema mechanism: append `CREATE TABLE IF NOT
EXISTS` plus indexes in `src/db/index.js` (SQLite startup) and
`scripts/postgres/schema.sql` (applied by `ensurePostgresAppSchema`). Add the
table to `appTables` and `identityColumns` in
`scripts/migrate-sqlite-to-postgres.mjs` so a SQLite-to-Postgres migration
cannot silently omit it. Do not rebuild either analytics table.

There is no existing analytics retention job. Create
`src/jobs/webAnalyticsRetention.js` with one explicit, idempotent daily purge
of both analytics tables using a closed 90-day cutoff. Start/stop it from
`src/index.js` following existing job conventions. The purge helper must accept
an injected cutoff for tests and delete only `occurred_at < cutoff`; it must not
read or emit row content.

**Verify**: `node --test tests/webAnalytics.test.mjs` -> tests prove valid
insert/aggregation, invalid names fail closed, paths lose query/fragment, and
SQLite/Postgres schema text contains the same columns and constraints. Start a
temporary pre-existing SQLite database with a sentinel legacy analytics row,
import the schema module, and assert the new table exists while the sentinel
row remains. Assert migration table-list parity includes the new table. Insert
expired and retained legacy/product rows, run the purge with an injected cutoff,
and assert only expired rows are removed.

### Step 3: Extend ingestion without weakening privacy controls

Allow `eventType: "product"` only when `eventName` passes the shared allowlist.
Keep the 2 KiB cap, DNT/GPC handling, bot filter, fetch-site check, ID/source
validation, and both rate limits. Product events must use the same cleaned path
and acquisition snapshot. Unknown fields are ignored, never persisted. Route
pageview/engagement to the existing table and product events to the new table.

**Verify**: analytics API tests cover valid product event (204), unknown name,
oversized/malformed body, cross-site request, DNT/GPC, and rate limit. Invalid
cases return the current privacy-preserving empty response and insert nothing.

### Step 4: Send events only under the existing consent decision

Have `AnalyticsTracker` listen for the custom event, dedupe its opaque
browser-only token, and send it only after the same consent/GPC/session
initialization used for pageviews. Have the GA consent component map an accepted
event to a GA4 custom event only while GA is loaded and consent remains granted.
On denial or GPC, neither first-party product events nor GA4 events may be sent.
Remove listeners and clear the bounded token set on unmount.

**Verify**: tests show no fetch/gtag before consent, one event after consent,
none after revocation, and no duplicate listener after rerender/navigation.
Add one dispatch -> tracker -> mocked API integration test asserting a confirmed
action produces exactly one ingestion call, even when the same custom event is
observed twice.

### Step 5: Instrument only confirmed successful user actions

Add the named calls after success, not on button press:

- prediction save response succeeds;
- follow create/remove mutation succeeds;
- notification preference PATCH succeeds;
- multiview first reaches two streams and share action succeeds;
- a global search result is opened (Plan 096; omit this call site until that
  plan exists, but keep the allowlist name);
- public source link and Discord join link are activated.

Guard against double firing from optimistic updates or React Strict Mode.

**Verify**: existing component tests are extended to assert one event on
success, zero on API error, and zero duplicates on rerender.

### Step 6: Add a product-events section to admin analytics

Expose aggregate event totals and unique sessions for the selected period, a
simple conversion rate using sessions as denominator, and a daily trend for
the top events. Localize EN/AR, use existing chart primitives, and render a
truthful empty state. Never expose visitor/session IDs or raw rows.

**Verify**: admin analytics tests/fixtures render events, zero-data state, and
Arabic RTL without raw identifiers.

### Step 7: Run full gates and privacy review

Run every command in the table. Inspect the diff for free-form analytics
fields with `git grep -n "trackProductEvent" -- apps/web/src` and verify every
call passes exactly one string literal from the allowlist.

## Test plan

- Extend `tests/webAnalytics.test.mjs` for DB validation and aggregation.
- Extend `apps/web/src/test/analytics-event.test.ts` for API negatives.
- Extend `apps/web/src/test/google-analytics-consent.test.ts` for consent
  gating and revocation.
- Add a small product analytics unit test for the closed contract.
- Add focused component assertions at successful mutation boundaries.
- Add retention tests covering both tables, injected cutoff, and no content
  logging; add startup/migration-list parity coverage for the additive table.
- Add one dispatch -> tracker -> ingestion test proving one confirmed action
  creates one product-event request without sending a token/property payload.

## Done criteria

- [ ] Nine event names are defined in one shared allowlist.
- [ ] No product event API accepts arbitrary names or metadata.
- [ ] DNT, GPC, denial, cross-site, malformed, and oversized requests insert
      zero rows.
- [ ] SQLite and Postgres schemas are equivalent.
- [ ] Existing SQLite databases gain the table additively with no legacy-row
      loss, and SQLite-to-Postgres migration includes it.
- [ ] Both analytics tables are purged only after the documented 90-day cutoff.
- [ ] Admin analytics exposes aggregates only, never raw identifiers.
- [ ] Advertising consent remains denied in all GA commands.
- [ ] All repository gates pass.

## STOP conditions

- Implementing an event requires storing an entity ID, query, pick, name, URL,
  or other user-provided value.
- Existing consent logic changed materially since the planned commit.
- Postgres and SQLite cannot be migrated without destructive table rebuilds.
- Plan 094 is not approved and available in the execution branch.
- A call site cannot distinguish confirmed success from optimistic intent.
- A requested metric requires joining analytics to authenticated user data.

## Maintenance notes

New events require an explicit code review of the central allowlist, docs copy,
tests, and admin label. Never turn this into a general event/property pipeline.
Reviewers should search the diff for `gtag`, `dataLayer`, and analytics payloads
and reject any advertising flag or personal dimension. They should also search
for `eventType.*product` outside the allowlist/route implementation and reject
any bypass of the shared contract.
