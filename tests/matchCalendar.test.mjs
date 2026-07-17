import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'match-calendar-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const { addTournament } = await import('../src/db/tournaments.js');
const { upsertMatch } = await import('../src/db/matches.js');
const { upsertPlayer } = await import('../src/db/players.js');
const { upsertTeam } = await import('../src/db/teams.js');
const {
  MAX_PERSONAL_CALENDAR_MATCHES,
  PERSONAL_CALENDAR_WINDOW_SECONDS,
  listUpcomingFollowedMatchesForUser,
  upsertFollow,
} = await import('../src/db/userFollows.js');

const NOW = 1_800_000_000;
const GUILD = 'match-calendar-guild';
const gameFan = '300000000000000001';
const tournamentFan = '300000000000000002';
const teamFan = '300000000000000003';
const playerFan = '300000000000000004';
const allFan = '300000000000000005';
const quietFan = '300000000000000006';
const boundaryFan = '300000000000000007';

let tournament;
let player;
let gameMatch;
let tournamentMatch;
let teamMatch;
let playerMatch;

async function createMatch(externalId, patch = {}) {
  return upsertMatch({
    tournament_id: tournament.id,
    source: 'liquipedia',
    external_id: externalId,
    team_a: 'Neutral Team',
    team_b: 'Other Team',
    status: 'scheduled',
    scheduled_at: NOW + 60,
    ...patch,
  });
}

test.before(async () => {
  tournament = await addTournament({
    source: 'liquipedia',
    external_id: 'match-calendar/cup',
    game: 'valorant',
    name: 'Calendar Cup',
    url: 'https://liquipedia.net/valorant/Calendar_Cup',
    guild_id: GUILD,
  });
  const playerTeam = await upsertTeam({ game: 'valorant', pandascore_id: 9101, name: 'Player Focus' });
  player = await upsertPlayer({
    game: 'valorant',
    pandascore_id: 9102,
    name: 'Calendar Player',
    current_team_id: playerTeam.id,
    current_team_pandascore_id: 9101,
    current_team_name: 'Player Focus',
  });

  gameMatch = await createMatch('Match:calendar-game', { scheduled_at: NOW + 60 });
  tournamentMatch = await createMatch('Match:calendar-tournament', { scheduled_at: NOW + 120 });
  teamMatch = await createMatch('Match:calendar-team', { team_a: 'Team Focus', scheduled_at: NOW + 180 });
  playerMatch = await createMatch('Match:calendar-player', { team_a: 'Player Focus', scheduled_at: NOW + 240 });

  await Promise.all([
    upsertFollow({ discordUserId: gameFan, entityType: 'game', entityKey: 'valorant' }),
    upsertFollow({ discordUserId: tournamentFan, entityType: 'tournament', entityKey: String(tournament.id) }),
    upsertFollow({ discordUserId: teamFan, entityType: 'team', entityKey: 'team focus!' }),
    upsertFollow({ discordUserId: playerFan, entityType: 'player', entityKey: String(player.id) }),
    upsertFollow({ discordUserId: allFan, entityType: 'game', entityKey: 'valorant' }),
    upsertFollow({ discordUserId: allFan, entityType: 'tournament', entityKey: String(tournament.id) }),
    upsertFollow({ discordUserId: allFan, entityType: 'team', entityKey: 'Team Focus' }),
    upsertFollow({ discordUserId: allFan, entityType: 'player', entityKey: String(player.id) }),
    upsertFollow({ discordUserId: boundaryFan, entityType: 'team', entityKey: 'Window Team' }),
  ]);
});

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('calendar schedule matches every follow type and deduplicates overlapping follows', async () => {
  for (const [fan, expectedMatch] of [
    [gameFan, gameMatch],
    [tournamentFan, tournamentMatch],
    [teamFan, teamMatch],
    [playerFan, playerMatch],
  ]) {
    const matches = await listUpcomingFollowedMatchesForUser(fan, { nowSec: NOW });
    assert.ok(matches.some((match) => match.id === expectedMatch.id), `expected ${fan} to see ${expectedMatch.id}`);
  }

  const allMatches = await listUpcomingFollowedMatchesForUser(allFan, { nowSec: NOW });
  assert.equal(allMatches.filter((match) => match.id === playerMatch.id).length, 1);
  assert.deepEqual([...allMatches].map((match) => match.scheduledAt), [...allMatches].map((match) => match.scheduledAt).sort((a, b) => a - b));
  assert.equal((await listUpcomingFollowedMatchesForUser(quietFan, { nowSec: NOW })).length, 0);
});

test('calendar schedule stays within the next 30 days and caps the response at 200 matches', async () => {
  const edge = await createMatch('Match:calendar-edge', {
    team_a: 'Window Team',
    scheduled_at: NOW + PERSONAL_CALENDAR_WINDOW_SECONDS,
  });
  const afterWindow = await createMatch('Match:calendar-after-window', {
    team_a: 'Window Team',
    scheduled_at: NOW + PERSONAL_CALENDAR_WINDOW_SECONDS + 1,
  });
  const past = await createMatch('Match:calendar-past', { team_a: 'Window Team', scheduled_at: NOW - 1 });
  for (let index = 0; index < MAX_PERSONAL_CALENDAR_MATCHES + 10; index += 1) {
    await createMatch(`Match:calendar-cap-${index}`, {
      team_a: `Calendar Team ${index}`,
      scheduled_at: NOW + 1_000 + index,
    });
  }

  const boundaryMatches = await listUpcomingFollowedMatchesForUser(boundaryFan, { nowSec: NOW });
  const matches = await listUpcomingFollowedMatchesForUser(gameFan, { nowSec: NOW });

  assert.ok(boundaryMatches.some((match) => match.id === edge.id));
  assert.ok(!boundaryMatches.some((match) => match.id === afterWindow.id || match.id === past.id));
  assert.equal(matches.length, MAX_PERSONAL_CALENDAR_MATCHES);
  assert.ok(matches.every((match) => match.scheduledAt >= NOW && match.scheduledAt <= NOW + PERSONAL_CALENDAR_WINDOW_SECONDS));
});
