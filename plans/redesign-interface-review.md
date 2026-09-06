# Interface skills review — 2026-09-06

## Scope and coverage

Applied the installed Jakub `better-interface`, `better-accessibility`, `better-layout`, `better-writing`, `better-typography`, `better-colors`, and `better-ui` skills. This is a rendered product review within the authorized redesign implementation, not a standalone branch review. No skill installation was needed.

Focused flow: homepage → match center → tournament, plus team/player search. Evidence includes populated, empty, refresh-error, mobile, Arabic, light/dark, keyboard, and reduced-motion states. Broader route evidence is recorded separately. This verdict does not claim a screen-reader walkthrough or an exhaustive review of every staff form.

Stack: Next.js Server Components, React, Tailwind, Base UI/shadcn primitives and existing semantic tokens. Read project AGENTS.md, web README, and the redesign architecture document. Preserve the deliberate dense esports presentation and existing bilingual content conventions.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Axe results; primary navigation/search/menu keyboard journeys; named controls; skip link; forced-colors focus; reduced motion | Clear within scope after fixes |
| Layout | 320/390/768/1440 screenshots; Arabic mirror; match/team score pairing; DOM section order; empty/filter states | Clear |
| Writing | Match refresh error with Retry; empty state with tournament destination; direct navigation labels; directory search labels | One finding fixed |
| Typography | Rendered font loading and computed input sizes; article measure; team-name truncation with full match/profile destinations; tabular scores | One finding fixed |
| Colors | Rendered WCAG contrast through axe in light/dark; semantic live/winner cues; primary/foreground tokens | Clear within sampled states |
| UI | Existing Base UI interactions; restrained row borders; theme provider disables transitions on switch; static selected/status cues; reduced-motion checks | Clear |

## Findings

All findings below were implemented and verified.

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH | Accessibility | `apps/web/src/app/esports.css:953` | Skip destination had no scroll margin under the sticky masthead | Apply the existing anchor scroll margin to `#main-content`; assert heading position after activating skip | Keyboard navigation must reveal the destination heading |
| MEDIUM | Accessibility | `apps/web/src/components/site-header-client.tsx:291` | Base UI SheetClose expected a button while rendering navigation links | Use native Next links and close the existing controlled sheet on activation | Preserve link semantics and eliminate the observed Base UI runtime warnings |
| MEDIUM | Writing | `apps/web/src/app/teams/page.tsx:150`, `apps/web/src/app/players/page.tsx:157` | Placeholder and accessible name without persistent visible label | Visible localized label bound to `directory-search` | The field purpose remains visible after entering a query |
| MEDIUM | Typography | `apps/web/src/app/esports.css:973` | Fluid root scale computed mobile input text at 15.18px | Mobile editable fields use `max(16px, 1rem)` | Avoids sub-16px input sizing while preserving larger user font settings |

Also added a `Highlight` system-color outline in forced-colors mode as defensive focus support, not as a claim that a prior measured failure existed.

## Verification

- `node scripts/redesign-interface-check.mjs`: ten English/Arabic route checks at 320 CSS px and 2x pixel density; no document overflow; input sizes 16px with labels; skip link focuses `main-content`; no animation lasting more than 1ms with reduced motion. Two forced-colors checks show a 2px system-color outline. The subsequent `redesign.pw.ts` assertion also checks that the heading is below the sticky header after activating skip.
- The 320 CSS px / 2x test models the reflow area of a 640px window at 200%; it is not a native browser-zoom test. CSS `zoom` was rejected as a proxy because it leaves viewport media queries unchanged.
- Broader evidence: 224 route/viewport combinations and 34 axe runs, with no reported axe violations. Browser regression results are in the progress tracker.
- **Not verified:** NVDA/VoiceOver speech output, native browser 200% zoom controls, iOS Safari's actual keyboard/zoom behavior, slow-motion replay in DevTools. Chromium rendering, accessibility semantics, and computed styles were inspected instead; they do not replace those platform checks.

## Verdict

Approve for the inspected scope. No HIGH findings remain in that scope.
