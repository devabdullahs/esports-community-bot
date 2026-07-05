// Tests for the EWC weekly-picks fixes:
//  1. Per-game pick options sourced from tracked participants (ewcGameParticipantTeams).
//  2. Week-open announcement selection (listEwcWeeksToAnnounceOpen / mark…).
//  3. Weekly pick objects rendered as display strings (formatWeeklyPickLabel).

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-weekly-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';

const { closeDb } = await import('../src/db/index.js');
const { addTournament } = await import('../src/db/tournaments.js');
const { replaceTournamentStandings } = await import('../src/db/tournamentStandings.js');
const { upsertMatch } = await import('../src/db/matches.js');
const { upsertEwcWeek, listEwcWeeksToAnnounceOpen, markEwcWeekOpenAnnounced, setEwcWeekStatus } = await import(
  '../src/db/ewcPredictions.js'
);
const { ewcGameParticipantTeams, matchParticipant } = await import('../src/lib/ewcGameTeams.js');
const { formatWeeklyPickLabel } = await import('../src/lib/ewcProfileStats.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

async function tournament(game, externalId) {
  return addTournament({
    source: 'liquipedia',
    external_id: externalId,
    game,
    name: externalId,
    url: null,
    guild_id: 'g-ewc',
    added_by: 'admin',
  });
}

// ---------------------------------------------------------------------------
// formatWeeklyPickLabel
// ---------------------------------------------------------------------------

test('formatWeeklyPickLabel renders per-game objects and passes strings through', () => {
  assert.equal(formatWeeklyPickLabel({ gameKey: 'ff', game: 'Free Fire', pick: 'EVOS Divine' }), 'Free Fire: EVOS Divine');
  assert.equal(formatWeeklyPickLabel({ gameKey: 'ff', pick: 'EVOS Divine' }), 'ff: EVOS Divine');
  assert.equal(formatWeeklyPickLabel({ pick: 'EVOS Divine' }), 'EVOS Divine');
  assert.equal(formatWeeklyPickLabel('Team Falcons'), 'Team Falcons');
  assert.equal(formatWeeklyPickLabel({}), '');
  assert.equal(formatWeeklyPickLabel(null), '');
});

// ---------------------------------------------------------------------------
// ewcGameParticipantTeams / matchParticipant
// ---------------------------------------------------------------------------

test('ewcGameParticipantTeams returns lobby-game participants from standings (incl. non-club-championship teams)', async () => {
  const t = await tournament('freefire', 'freefire/Esports_World_Cup/2026');
  await replaceTournamentStandings(t.id, [
    {
      title: 'Group A',
      entries: [
        { rank: 1, team: 'EVOS Divine' },
        { rank: 2, team: 'Team Falcons' },
        { rank: 3, team: 'TBD' }, // placeholder must be excluded
      ],
    },
  ]);

  const teams = await ewcGameParticipantTeams('Free Fire');
  assert.ok(teams.includes('EVOS Divine'), 'game-specific qualifier is present');
  assert.ok(teams.includes('Team Falcons'));
  assert.ok(!teams.includes('TBD'), 'TBD is filtered');

  // matchParticipant resolves case/format-insensitively to the canonical name.
  assert.equal(matchParticipant('evos divine', teams), 'EVOS Divine');
  assert.equal(matchParticipant('Not A Team', teams), null);
});

test('ewcGameParticipantTeams excludes BR schedule junk rows from matches for lobby games', async () => {
  const t = await tournament('pubg', 'pubg/Esports_World_Cup/2026');
  // BR schedule rows the parser stores in matches — never real teams.
  await upsertMatch({
    tournament_id: t.id,
    source: 'liquipedia',
    external_id: 'pubg:EWC:br-schedule:0',
    team_a: 'Group A - Game 1',
    team_b: 'Lobby',
    status: 'scheduled',
    scheduled_at: 1784620800,
  });
  await replaceTournamentStandings(t.id, [
    { title: 'Overall', entries: [{ rank: 1, team: 'Twisted Minds' }] },
  ]);

  const teams = await ewcGameParticipantTeams('PUBG');
  assert.ok(teams.includes('Twisted Minds'));
  assert.ok(!teams.some((name) => /game\s*\d/i.test(name) || /^lobby$/i.test(name)), 'schedule junk excluded');
});

test('ewcGameParticipantTeams uses match teams for head-to-head games', async () => {
  const t = await tournament('valorant', 'valorant/Esports_World_Cup/2026');
  await upsertMatch({
    tournament_id: t.id,
    source: 'liquipedia',
    external_id: 'valorant:EWC:bracket:0',
    team_a: 'Team Heretics',
    team_b: 'Paper Rex',
    status: 'scheduled',
    scheduled_at: 1784620800,
  });

  const teams = await ewcGameParticipantTeams('Valorant');
  assert.ok(teams.includes('Team Heretics'));
  assert.ok(teams.includes('Paper Rex'));
});

test('ewcGameParticipantTeams excludes teams from unrelated (non-EWC) tracked tournaments', async () => {
  // Same game, active, but NOT an EWC event: its teams must not become pick options.
  const lck = await tournament('leagueoflegends', 'leagueoflegends/LCK/2026_Season');
  await upsertMatch({
    tournament_id: lck.id,
    source: 'liquipedia',
    external_id: 'lol:LCK:bracket:0',
    team_a: 'Dplus KIA',
    team_b: 'KT Rolster',
    status: 'scheduled',
    scheduled_at: 1784620800,
  });
  const ewc = await tournament('leagueoflegends', 'leagueoflegends/Esports_World_Cup/2026');
  await upsertMatch({
    tournament_id: ewc.id,
    source: 'liquipedia',
    external_id: 'lol:EWC:bracket:0',
    team_a: 'Gen.G',
    team_b: 'T1',
    status: 'scheduled',
    scheduled_at: 1784620800,
  });

  const teams = await ewcGameParticipantTeams('League of Legends');
  assert.ok(teams.includes('Gen.G'), 'EWC event team present');
  assert.ok(teams.includes('T1'));
  assert.ok(!teams.includes('Dplus KIA'), 'non-EWC tournament team excluded');
  assert.ok(!teams.includes('KT Rolster'));
});

// ---------------------------------------------------------------------------
// listEwcWeeksToAnnounceOpen / markEwcWeekOpenAnnounced
// ---------------------------------------------------------------------------

const now = Math.floor(Date.now() / 1000);

async function week(weekKey, { openAt, closeAt, status = 'open' } = {}) {
  const w = await upsertEwcWeek({
    guildId: 'g-ewc',
    season: '2026',
    weekKey,
    label: weekKey,
    openAt,
    closeAt,
    games: [{ key: 'ff', game: 'Free Fire', event: 'Group Stage' }],
    createdBy: 'admin',
  });
  if (status !== 'open') await setEwcWeekStatus(w.id, status);
  return w;
}

test('listEwcWeeksToAnnounceOpen returns only currently-open, unannounced weeks', async () => {
  const open = await week('open-now', { openAt: now - 60, closeAt: now + 3600 });
  await week('future', { openAt: now + 3600, closeAt: now + 7200 }); // not open yet
  await week('closed', { openAt: now - 7200, closeAt: now - 60 }); // already closed
  await week('scored-week', { openAt: now - 60, closeAt: now + 3600, status: 'scored' });

  const due = await listEwcWeeksToAnnounceOpen(now);
  const keys = due.map((w) => w.week_key);
  assert.ok(keys.includes('open-now'), 'open window is announced');
  assert.ok(!keys.includes('future'), 'a week before its open_at is not announced');
  assert.ok(!keys.includes('closed'), 'a closed week is not announced');
  assert.ok(!keys.includes('scored-week'), 'a scored week is not announced');

  // Stamping removes it from the due list (announce exactly once).
  await markEwcWeekOpenAnnounced(open.id);
  const after = (await listEwcWeeksToAnnounceOpen(now)).map((w) => w.week_key);
  assert.ok(!after.includes('open-now'), 'announced week is no longer due');
});
