# Automatic Liquipedia tournament tracking

The bot reads each followed community game's **Main_Page** on Liquipedia and takes tournament links from its tournament listings. It accepts explicit S-Tier, A-Tier, Tier 1, and Tier 2 badges. Unknown and lower tiers are skipped; being featured does not by itself grant a tier exception.

Community games come from the guild's match-card, leaderboard, and voice boards plus currently tracked tournaments. The all-games board does not mean every Liquipedia wiki. Personal member follows do not change the community tracking scope.

Discovery runs automatically when the bot starts (first tick after five minutes). Each tick visits one game, through the existing serialized Liquipedia client. Each game is revisited after six hours; scan timestamps persist in `data/tournament-discovery.json`. Failures rotate to the next game and retry on a later sweep. Set `TOURNAMENT_DISCOVERY_ENABLED=false` to disable it.

Eligible links enter the existing durable `validate_and_activate` operation queue. They are provider-validated, tracked, initially synced, and armed for normal polling by that worker. Stable idempotency keys prevent repeated scans from duplicating operations. Existing tournaments, including archived/deactivated ones, are excluded. The insert also preserves existing rows if an administrator archives an event while its validation is queued.

Coverage follows what each wiki lists on its main page, including its recent/current/upcoming sections; it is not an exhaustive crawl of historical tournament archives. Supported layouts include modern tournament cards, Dota's inline tournament rows, and tiered grid/table listings. Logs report eligible events and rows without a tier so layout changes can be diagnosed.

Verification: mocked parser/database regressions cover tier filtering, duplicate suppression, game scope, and archive protection. Manual read-only checks through the normal rate-limited client found 16 eligible League main-page events and 19 Dota main-page events. Automated tests never contact Liquipedia.
