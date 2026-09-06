# Bot match updates and card reliability

Implemented on `codex/bot-match-card-reliability`.

## Reliability

- Discord deletion failures retain the stored message ID. Only successful deletion, Unknown Message (10008), or a confirmed deleted channel (10003) allows tracking to be removed.
- Transient message-fetch errors no longer cause replacement posts. Live-card rendering starts after that lookup succeeds, avoiding wasted image work on failed lookups.
- A failed game board no longer aborts updates for other game boards.
- A one-minute refresh loop retries from stored data, even without another match event. The configured guild remains eligible after its last active tournament disappears.
- Refresh bursts are coalesced while a refresh is running: one current pass and at most one scheduled follow-up. Pending timers are cancelled on shutdown.
- Leaderboard, voice, and card refreshes are independent, so a slow leaderboard upload does not hold up card cleanup.

## Presentation

- Compact 1200 x 520 match cards, full game names, local game icons where available, clearer live/final colors, and Riyadh timestamps.
- Missing live scores say Score pending / Awaiting update; missing final results say Result unavailable. No invented scores.
- Team crests retain the existing cached loader and fallback initials.
- Match links prefer a known Liquipedia Match page, falling back to the tournament.
- The runtime Docker image now includes the existing game icon assets. No new external image requests are added for these icons.

## Verification

- Bot suite: 1,009 passed, 16 skipped.
- Web suite: 1,474 passed across 145 files.
- Web lint, production build, security boundary gate: passed.
- Focused card and refresh regressions: 15 passed after the final lookup/render ordering change.
- Canvas live, final, and lobby previews inspected locally. Tests use fixtures/mocked Discord and do not contact Liquipedia.

## Operational limits

This addresses the match-update pipeline and presentation, not a rewrite of every slash command or service. The existing stale-match timeout and scoring rules remain in place. Liquipedia's serialized queue and rate limits remain unchanged.

The screenshot is consistent with the tracking bug, but production logs and database rows were not available to prove its exact cause. Posts whose IDs the old code already lost cannot be recovered from that table; they require targeted live cleanup. No Discord messages were sent or deleted during this work. No production deployment or Docker runtime build was performed.
