# Esports Community UI architecture

Branch: `redesign/esports-experience`, based on `origin/main` (0109d53).

## Audit and direction

The production homepage puts a marketing introduction, four large metrics, and three calls to action before fixtures. Competition, games, and news are hidden in broad desktop menus. Repeated rounded panels obscure tournament/match relationships. Mobile loses direct primary navigation. Live status varies between blue and red. News and game hubs need editorial hierarchy.

Direction: a competition desk. Compact masthead; direct Live / Tournaments / Games / News navigation; secondary community rail; chronological match rows; restrained blue identity; crisp surfaces; comfortable bilingual typography. Thmanyah Sans remains the only site font.

## Decision

Retain Next.js Server Components, React, TypeScript, Tailwind, TanStack Query/Table, and Better Auth. Retain Base UI and source-owned shadcn behavioral primitives: menus, sheets, dialogs, tabs, selects, tooltips, form controls. Retain staff CMS components. Customize semantic tokens and build public presentation from domain-specific components instead of repeating generic cards.

Replace the homepage hero/stat grid, grouped primary navigation, oversized game tiles, repetitive news containers, and live match cards. Extend existing competition primitives instead of adding another library.

New shared concepts: SectionHeading, MatchRow, ScheduleGroup, NewsStory, contextual navigation. Results remain paired with teams under RTL. Status has a word and an icon as well as color.

## Contracts and risks

Keep URLs, API contracts, cache/auth boundaries, source attributions, prediction logic, uploads, bot/database modules, and security headers. Reuse cached public projections. Client interaction stays in small components.

Risks: global tokens affect CMS; RTL can reverse scores independently from teams; dense rows can overflow long names; refreshed data can disrupt selected tabs. Validate these specifically. Preview uses a disposable SQLite database and loopback server.

## Research (2026-09-05)

- [VLR schedule](https://www.vlr.gg/matches): date-grouped rows align time, participants, event; schedule/results are adjacent. Apply alignment and chronological grouping.
- [HLTV](https://www.hltv.org): matches, results, events, rankings, news are immediately discoverable; compact headlines support repeat visits. Apply direct navigation and editorial hierarchy.
- [start.gg](https://www.start.gg): discovery begins with events and search. Keep tournament context and filters close to data.
- [Liquipedia redesign FAQ](https://liquipedia.net/hub/Liquipedia%3AChangelogs/Redesign_FAQ): mobile reading and discoverability motivate clearer navigation. [Tournament portal](https://liquipedia.net/counterstrike/Portal%3ATournaments) and [list module](https://liquipedia.net/commons/Module%3ATournamentsList) show explicit tiers/status, event dates, participants, and winners. Apply contextual sections and distinguish schedule/results. Searchable primary pages were read; direct browser access presented a human-verification challenge. No challenge bypass attempted.
- [Esports Community](https://esportscommunity.net): actual desktop/mobile homepage inspected. Strengths: game recognition, bilingual content, tournament data, search. Expose them earlier.

Progress tracker and browser/test evidence determine completion.

## Implementation refinements

- Direct competition destinations remain visible on mobile; secondary features are grouped in the menu. Global search has one mounted keyboard handler. Locale rewriting is normalized before computing the active link, preventing an Arabic hydration mismatch.
- Tournament pages retain existing bracket projection, feeder edges, stage switching, standings, polling, reminders, and result pagination. New context navigation points to real section anchors; overview follows the competition content in both DOM and visual order.
- Game hubs foreground fixtures/results and connect editorial coverage with tournaments. Media posts use the shared news presentation. Public profile/directory headers, tables, cards, and footer share restrained geometry; account/admin interaction primitives remain intact.
- Scores are rendered as individual spans in locale-aware layouts and remain paired with the same team. Shared match links announce each competitor and score. Match details have a semantic page heading.
- Existing Thmanyah Sans files (Regular/Medium/Bold, 236 KB total) are served from public/fonts because the configured CDN lacks browser CORS headers. No new font family or runtime dependency was introduced.
- Results on the global match center remain the existing five most recent results; the archive link leads to full tournament histories. Source attributions and real data limits stay visible.

## Reference access limits

VLR and start.gg were visually inspected. HLTV primary HTML/search content was read, but its browser presented Cloudflare verification. Liquipedia primary search-accessible documentation was read; its browser also presented verification. Reference captures are local evidence, not claims of access behind those checks.
