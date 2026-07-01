## PandaScore coverage

Blocked for prod numbers on 2026-07-01. The required read-only Postgres query could not be run from this workspace because no `DATABASE_URL` is exposed and `DB_DRIVER` is unset; I checked only env-var presence and did not print secrets. I did not substitute SQLite or the stale NAS backup for the requested prod counts.

Verified repo context: SQLite and Postgres both define `teams` and `players` with `pandascore_id`, `raw_json`, `image_url`, `nationality`, `role` on players, and player `current_team_id`/`current_team_pandascore_id`; public profile pages already read these rows. `matches` stores only `team_a`/`team_b` names, so the future prod query must filter active, non-archived tournaments, exclude start.gg preview rows, resolve match names to team rows by normalized name/game, then count players under the resolved current teams.

| Entity set | Total | `% image_url` | `% nationality` | `% role` | `% resolved current team` |
| --- | ---: | ---: | ---: | ---: | ---: |
| Teams referenced by tracked matches | Blocked | Blocked | Blocked | N/A | N/A |
| Players on resolved referenced teams | Blocked | Blocked | Blocked | Blocked | Blocked |

## PandaScore endpoint capability

- Team: usable. `GET /teams/126061` for T1 returned 200 with id/name/slug/image/current videogame fields and a five-player `players` roster.
- Roster: usable. `GET /tournaments/21176/rosters` returned 200 with a `rosters` payload for the 2026 MSI Playoffs sample.
- Tournaments-per-entity: usable. `GET /teams/126061/tournaments` and `GET /players/faker/tournaments` both returned 200 with non-empty tournament arrays.
- Match-lineup: partial. `GET /matches/1524761/opponents` returned 200 with match opponent data, but `GET /lol/matches/1524761/players/stats` returned 403 `Access Denied`, so per-player match lineup/stats are not usable on the current plan.

## LoL name→Liquipedia-page resolver hit-rate

Resolver path: `searchPages('leagueoflegends', name, 6)` imported from `src/services/liquipedia.js`, so every lookup went through the existing serialized Liquipedia opensearch queue. Because prod Postgres was unavailable and current local SQLite only had six active LoL team names, the 15-name sample below came from the stale NAS SQLite backup's active tracked LoL tournaments; use it as resolver mechanics evidence, not prod-current coverage.

| Input name | Result | Canonical page |
| --- | --- | --- |
| Cloud9 | Hit | `https://liquipedia.net/leagueoflegends/Cloud9` |
| FlyQuest | Hit | `https://liquipedia.net/leagueoflegends/FlyQuest` |
| LYON | Hit | `https://liquipedia.net/leagueoflegends/LYON` |
| Team Liquid | Hit | `https://liquipedia.net/leagueoflegends/Team_Liquid` |
| Shopify Rebellion | Hit | `https://liquipedia.net/leagueoflegends/Shopify_Rebellion` |
| Team WE | Hit | `https://liquipedia.net/leagueoflegends/Team_WE` |
| LNG Esports | Hit | `https://liquipedia.net/leagueoflegends/LNG_Esports` |
| Invictus Gaming | Hit | `https://liquipedia.net/leagueoflegends/Invictus_Gaming` |
| ThunderTalk Gaming | Hit | `https://liquipedia.net/leagueoflegends/ThunderTalk_Gaming` |
| Ninjas in Pyjamas | Hit | `https://liquipedia.net/leagueoflegends/Ninjas_in_Pyjamas` |
| EDward Gaming | Hit | `https://liquipedia.net/leagueoflegends/EDward_Gaming` |
| Weibo Gaming | Hit | `https://liquipedia.net/leagueoflegends/Weibo_Gaming` |
| JD Gaming | Hit | `https://liquipedia.net/leagueoflegends/JD_Gaming` |
| Top Esports | Hit | `https://liquipedia.net/leagueoflegends/Top_Esports` |
| Bilibili Gaming | Hit | `https://liquipedia.net/leagueoflegends/Bilibili_Gaming` |

Final hit-rate: 15 hits / 0 misses / 0 ambiguous cases = 100%.

## Recommendation

Narrow. Proceed only with a small slice that enriches already-resolved PandaScore team/player profiles and adds Liquipedia page links through the existing queued resolver; do not plan per-match player lineups/stats until the PandaScore plan changes, and do not broaden beyond the single guild.

Single biggest risk: entity resolution and measured coverage are still unknown in prod because tracked matches store names rather than entity IDs, and the required read-only Postgres coverage query was blocked here.
