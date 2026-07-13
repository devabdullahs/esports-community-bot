# Plan 094: Improve SEO and search discoverability

> **Executor instructions**: Implement this plan serially. Preserve private/admin
> route boundaries and never publish draft content. Run every verification gate
> before merge and deployment.

## Status

- **State**: DONE
- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: correctness, performance, tests, docs, direction
- **Planned at**: commit `0f1ff8a`, 2026-07-13
- **Completed**: 2026-07-13

## Why this matters

Search engines can crawl the site, but article locale signals conflict, the
sitemap omits public canonical content, paginated archives canonicalize to page
one, and social promotion is not measured as an owned-content acquisition loop.
This plan makes discovery complete and language-correct, adds machine-readable
content signals, and gives operators enough attribution to improve publishing.

## Scope and decisions

1. Shared news has one public locale; translated news exposes only complete
   translations. All article consumers use one canonical-news URL helper.
2. Valid populated pagination self-canonicalizes. Filters/search are
   `noindex,follow`; tracking parameters keep a clean canonical.
3. Sitemaps include only substantive public profiles and complete match-detail
   pages. Drafts, private pages, placeholders, and query variants remain out.
4. RSS uses physical `/feed.xml` and `/feed-ar.xml` routes.
5. IndexNow is optional, bounded, asynchronous through Next `after()`, and
   covers publish, update, move, unpublish, and delete URL lifecycles.
6. Tournament and match pages receive unique metadata and breadcrumb structured
   data. `SportsEvent` is intentionally omitted until a verified physical or
   virtual location is available; required event fields are never invented.
7. Acquisition data is an allowlisted category and optional bounded campaign,
   never a raw destination URL or query string.
8. Cookie-free top-level public HTML advertises a short Cloudflare-only cache
   TTL. Any cookie, query, RSC/prefetch request, asset-like path, or private
   route fails closed to dynamic rendering; `/ar` remains a distinct cache key.

## Implementation order

1. Add canonical-news, query-policy, breadcrumb, and profile/match indexability
   helpers with focused unit tests.
2. Update game/media article routes, pagination metadata, and login crawler
   directives.
3. Build complete sitemap inventory, localized feeds, IndexNow lifecycle hooks,
   and their tests.
4. Add unique tournament/match metadata and conservative JSON-LD.
5. Add privacy-safe acquisition tracking, social campaign links, and the SEO
   operations runbook.
6. Add conservative anonymous HTML edge-cache admission and negative tests.

## Verification

- `npm test`
- `npm --workspace @esports-community-bot/web run lint`
- `npm --workspace @esports-community-bot/web run test`
- `npm run web:build`
- `npm audit --audit-level=high`

## STOP conditions

- Any sitemap query would expose drafts, private profiles, auth/session rows, or
  raw enrichment payloads.
- Locale correction would lose the only complete translation instead of
  redirecting to it.
- IndexNow failure can affect a successful CMS mutation.
- Structured data requires inventing a venue, timestamp, participant, or result.

## Maintenance notes

Never broaden anonymous HTML caching to cookie-bearing requests. If public
rendering is later split from viewer-specific follow/session state, evaluate
ISR as a separate measured performance plan. Partition the sitemap before it
approaches the protocol's 50,000 URL limit.
