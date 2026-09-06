# Esports Community redesign

## Architecture

Retained Next.js, server rendering, cached public data projections, React, Tailwind, Better Auth, and Base UI/shadcn interaction primitives. Replaced the public homepage hero/stat grid, grouped primary navigation, oversized game tiles, repeated news cards, and live match cards with a domain presentation layer: `MatchRow`, `ScheduleGroup`, `NewsStory`, and `SectionHeading`.

Staff workflows and public community widgets retain their business behavior while sharing the revised typography, surfaces, focus treatment, and public page geometry. No API route, proxy, scoring, bot, database schema, or dependency-lockfile changes are part of this redesign.

## UX and visual system

Matches, tournaments, games, and news are direct destinations on desktop and mobile. The homepage leads with live fixtures, upcoming matches, and results. Tournament pages provide section links to live/upcoming/results/bracket/standings/overview. Existing stage switching, bracket relationships, pagination, reminders, filters, and polling remain available.

Thmanyah Sans remains the bilingual typeface, now served as same-origin WOFF2 files because the prior font CDN response lacked browser CORS headers. Navy and white surfaces, restrained blue identity, compact rows, consistent spacing, and semantic red live / green winner / gold upcoming colors establish the visual system. Status also has text or icons.

## Routes

Primary restructuring covers home, match center, games and game hubs, tournament discovery/detail/archive, and the newsroom. Match detail headers, team/player directories and profiles, article presentation, media channels, and navigation were refined. Predictions, leaderboards, predictor profiles, clubs, MVP, co-streams, partners, account, login, documentation, legal, offline, loading, error, and not-found surfaces share the redesigned shell and public styles. Existing community and staff interaction components were retained where replacement would not improve the task.

## Arabic, responsive behavior, and accessibility

Arabic navigation mirrors correctly and retains active-route state. Competitors keep their own score in RTL; mixed-direction names use isolation. Mobile exposes the four primary destinations without opening a menu. Narrow game headers and match tabs were refined at 320px.

Improvements include semantic match headings and bracket hierarchy, accessible search/combobox names, persistent directory input labels, 16px mobile inputs, keyboard-scrollable article code blocks, skip navigation, visible focus, Windows High Contrast focus, reduced-motion support, and measured light/dark contrast fixes. The separate interface-skills review records inspected scope and platform verification limits.

## Frontend performance

Kept server-rendered composition and existing cached data access. Removed a duplicate mounted global-search component and unnecessary signed-out requests for private prediction panels. Same-origin fonts eliminate the observed CORS failures; story images have dimensions and lazy loading. No new runtime library was added. These are implementation improvements, not an asserted Lighthouse or production latency gain.

## Validation and limits

See `full-site-redesign-progress.md` for final commands/results and `redesign-interface-review.md` for the Jakub skill review. Final machine-readable route, axe, and focused interface evidence is retained under `redesign-evidence/`; screenshots and raw logs remain local.

The preview uses disposable fixtures. Live providers can throttle embeds: co-stream inspection observed provider-side HTTP 429 and iframe permissions-policy messages. External OAuth credentials, real production writes, NVDA/VoiceOver, native browser zoom controls, and iOS Safari were not exercised. One-language articles retain their canonical-language redirect; unknown single-segment IndexNow keys retain their existing plain-text 404. The global match center intentionally retains its existing five recent results with links to tournament histories.
