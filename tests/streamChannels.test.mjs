import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'stream-channels-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const {
  parseChannelHandle,
  parseGameSlugs,
  channelUrl,
  createStreamChannel,
  getStreamChannel,
  listStreamChannels,
  listEwcStreamChannels,
  channelsForMatch,
  channelsForTournament,
  updateStreamChannel,
  setStreamChannelActive,
  deleteStreamChannel,
  listDistinctActiveHandles,
  syncLiquipediaBroadcasters,
} = await import('../src/db/streamChannels.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('parseChannelHandle normalizes URLs, @handles, and bare handles', () => {
  assert.equal(parseChannelHandle('twitch', 'https://www.twitch.tv/OWBrain'), 'owbrain');
  assert.equal(parseChannelHandle('twitch', 'twitch.tv/OWBrain/videos'), 'owbrain');
  assert.equal(parseChannelHandle('twitch', '@OWBrain'), 'owbrain');
  assert.equal(parseChannelHandle('kick', 'https://kick.com/SomeOne?foo=1'), 'someone');
  assert.equal(parseChannelHandle('youtube', 'https://youtube.com/@MixedCase'), 'MixedCase', 'YouTube keeps case');
  assert.equal(parseChannelHandle('twitch', ''), '');
});

test('channelUrl builds a per-platform watch URL', () => {
  assert.equal(channelUrl('twitch', 'owbrain'), 'https://www.twitch.tv/owbrain');
  assert.equal(channelUrl('kick', 'someone'), 'https://kick.com/someone');
  assert.equal(channelUrl('youtube', 'Chan'), 'https://www.youtube.com/@Chan');
});

test('parseGameSlugs accepts several separators and normalizes aliases', () => {
  assert.deepEqual(parseGameSlugs('overwatch, rocket-league، teamfighttactics | valorant'), [
    'overwatch',
    'rocketleague',
    'tft',
    'valorant',
  ]);
});

test('createStreamChannel validates platform, scope, and scope keys', async () => {
  await assert.rejects(() => createStreamChannel({ platform: 'mixer', handle: 'x', scope: 'game', gameSlug: 'overwatch' }), /platform/i);
  await assert.rejects(() => createStreamChannel({ platform: 'twitch', handle: 'x', scope: 'planet' }), /scope/i);
  await assert.rejects(() => createStreamChannel({ platform: 'twitch', handle: 'x', scope: 'game' }), /game/i);
  await assert.rejects(() => createStreamChannel({ platform: 'twitch', handle: 'x', scope: 'team' }), /team/i);
  await assert.rejects(() => createStreamChannel({ platform: 'twitch', handle: 'x', scope: 'match' }), /match/i);
  await assert.rejects(() => createStreamChannel({ platform: 'twitch', handle: '   ', scope: 'ewc' }), /handle/i);
});

test('createStreamChannel hydrates a row with a watch URL', async () => {
  const ch = await createStreamChannel({
    platform: 'twitch',
    handle: 'https://twitch.tv/OWBrain',
    label: 'OWBrain',
    scope: 'game',
    gameSlug: 'overwatch',
    language: 'en',
    addedBy: 'admin-1',
  });
  assert.equal(ch.platform, 'twitch');
  assert.equal(ch.handle, 'owbrain', 'handle is normalized on the way in');
  assert.equal(ch.scope, 'game');
  assert.equal(ch.gameSlug, 'overwatch');
  assert.deepEqual(ch.gameSlugs, ['overwatch']);
  assert.equal(ch.label, 'OWBrain');
  assert.equal(ch.active, true);
  assert.equal(ch.url, 'https://www.twitch.tv/owbrain');
});

test('game-scoped channels can target multiple games', async () => {
  const ch = await createStreamChannel({
    platform: 'twitch',
    handle: 'multi_game',
    label: 'Multi Game',
    scope: 'game',
    gameSlugs: ['overwatch', 'rocket-league'],
  });
  assert.equal(ch.gameSlug, 'overwatch');
  assert.deepEqual(ch.gameSlugs, ['overwatch', 'rocketleague']);

  const rlChannels = await listStreamChannels({ scope: 'game', gameSlug: 'rocketleague' });
  assert.ok(rlChannels.some((c) => c.id === ch.id), 'secondary game tag is filterable');

  const matched = await channelsForMatch({ gameSlug: 'rocketleague', includeEwc: false });
  assert.ok(matched.some((c) => c.id === ch.id), 'secondary game tag matches live cards');
});

test('only one platform is default within a creator group', async () => {
  const first = await createStreamChannel({
    platform: 'twitch',
    handle: 'creator_default',
    label: 'Creator Default',
    creatorKey: 'creator-default',
    scope: 'ewc',
    isDefault: true,
  });
  const second = await createStreamChannel({
    platform: 'kick',
    handle: 'creator_default',
    label: 'Creator Default',
    creatorKey: 'creator-default',
    scope: 'ewc',
    isDefault: true,
  });
  assert.equal((await getStreamChannel(second.id)).isDefault, true);
  assert.equal((await getStreamChannel(first.id)).isDefault, false);
});

test('creator-level edits propagate to a creator\'s sibling platforms', async () => {
  const twitch = await createStreamChannel({
    platform: 'twitch',
    handle: 'creator_edit_tw',
    label: 'Old Name',
    creatorKey: 'creator-edit',
    scope: 'ewc',
  });
  const kick = await createStreamChannel({
    platform: 'kick',
    handle: 'creator_edit_kk',
    label: 'Old Name',
    creatorKey: 'creator-edit',
    scope: 'ewc',
  });

  await updateStreamChannel(twitch.id, { label: 'New Name', gameSlugs: ['valorant'] });

  const twAfter = await getStreamChannel(twitch.id);
  const kkAfter = await getStreamChannel(kick.id);
  assert.equal(twAfter.label, 'New Name');
  assert.equal(kkAfter.label, 'New Name', 'creator label propagated to sibling');
  assert.deepEqual(twAfter.gameSlugs, ['valorant']);
  assert.deepEqual(kkAfter.gameSlugs, ['valorant'], 'creator game tags propagated to sibling');
  // Per-row attributes we did NOT pass stay untouched on the sibling.
  assert.equal(kkAfter.handle, 'creator_edit_kk', 'per-row handle unchanged on sibling');
  assert.equal(kkAfter.platform, 'kick', 'per-row platform unchanged on sibling');
});

test('re-adding the same channel at the same scope upserts (no duplicate)', async () => {
  const first = await createStreamChannel({ platform: 'kick', handle: 'dupe', scope: 'ewc', label: 'First' });
  const again = await createStreamChannel({ platform: 'kick', handle: 'dupe', scope: 'ewc', label: 'Renamed' });
  assert.equal(first.id, again.id, 'same row');
  assert.equal(again.label, 'Renamed', 'label upserted');
  const ewc = await listEwcStreamChannels();
  assert.equal(ewc.filter((c) => c.handle === 'dupe').length, 1, 'only one row');
});

test('listStreamChannels filters by scope, game, and active-only', async () => {
  await createStreamChannel({ platform: 'twitch', handle: 'ow_team', scope: 'team', team: 'Twisted Minds' });
  await createStreamChannel({ platform: 'twitch', handle: 'rl_game', scope: 'game', gameSlug: 'rocketleague' });

  const games = await listStreamChannels({ scope: 'game' });
  assert.ok(games.every((c) => c.scope === 'game'));
  assert.ok(games.some((c) => c.gameSlug === 'rocketleague'));

  const owGames = await listStreamChannels({ scope: 'game', gameSlug: 'overwatch' });
  assert.ok(owGames.every((c) => c.gameSlug === 'overwatch'));

  const deactivated = await createStreamChannel({ platform: 'soop', handle: 'gone', scope: 'ewc' });
  await setStreamChannelActive(deactivated.id, false);
  const activeEwc = await listEwcStreamChannels({ activeOnly: true });
  assert.ok(!activeEwc.some((c) => c.handle === 'gone'), 'inactive channels excluded');
});

test('channelsForMatch unions game + team + match + ewc and dedupes by platform+handle', async () => {
  // Fresh, isolated game/teams to avoid cross-test interference.
  const game = 'valorant';
  await createStreamChannel({ platform: 'twitch', handle: 'val_caster', scope: 'game', gameSlug: game });
  await createStreamChannel({ platform: 'twitch', handle: 'tm_fan', scope: 'team', team: 'Team Vitality' });
  await createStreamChannel({ platform: 'kick', handle: 'pinned', scope: 'match', matchExternalId: 'Match:VAL-1' });
  await createStreamChannel({ platform: 'twitch', handle: 'ewc_official', scope: 'ewc' });
  // Same channel both as game-scope AND ewc — must appear once.
  await createStreamChannel({ platform: 'twitch', handle: 'val_caster', scope: 'ewc' });

  const matched = await channelsForMatch({
    gameSlug: game,
    teamA: 'Team Vitality',
    teamB: 'Sentinels',
    matchExternalId: 'Match:VAL-1',
    includeEwc: true,
  });
  const handles = matched.map((c) => `${c.platform}:${c.handle}`);

  assert.ok(handles.includes('twitch:val_caster'), 'game-scope channel matched');
  assert.ok(handles.includes('twitch:tm_fan'), 'team-scope channel matched on team A');
  assert.ok(handles.includes('kick:pinned'), 'match-scope channel matched');
  assert.ok(handles.includes('twitch:ewc_official'), 'ewc channel included');
  assert.equal(
    handles.filter((h) => h === 'twitch:val_caster').length,
    1,
    'a channel matching multiple scopes appears once',
  );
});

test('channelsForMatch can exclude the EWC list and unrelated games/teams', async () => {
  const matched = await channelsForMatch({ gameSlug: 'valorant', teamA: 'Nobody', teamB: 'Nobody2', includeEwc: false });
  assert.ok(matched.some((c) => c.handle === 'val_caster'), 'game match still present');
  assert.ok(!matched.some((c) => c.handle === 'ewc_official'), 'ewc excluded when not requested');
  assert.ok(!matched.some((c) => c.handle === 'tm_fan'), 'unrelated team excluded');
});

test('channelsForTournament unions game + team + match + ewc across a tournament', async () => {
  // Unique handles so this stands apart from the channelsForMatch fixtures above.
  await createStreamChannel({ platform: 'twitch', handle: 'tour_game', scope: 'game', gameSlug: 'valorant' });
  await createStreamChannel({ platform: 'twitch', handle: 'tour_team', scope: 'team', team: 'Team Vitality' });
  await createStreamChannel({ platform: 'kick', handle: 'tour_match', scope: 'match', matchExternalId: 'Match:T-1' });
  await createStreamChannel({ platform: 'youtube', handle: 'tour_ewc', scope: 'ewc' });

  const withEwc = await channelsForTournament({
    gameSlug: 'valorant',
    teams: ['Team Vitality', 'Sentinels'],
    matchExternalIds: ['Match:T-1'],
    includeEwc: true,
  });
  const handles = withEwc.map((c) => `${c.platform}:${c.handle}`);
  assert.ok(handles.includes('twitch:tour_game'), 'game-scope channel returned');
  assert.ok(handles.includes('twitch:tour_team'), 'team-scope channel returned');
  assert.ok(handles.includes('kick:tour_match'), 'match-scope channel returned');
  assert.ok(handles.includes('youtube:tour_ewc'), 'ewc channel returned when requested');

  const withoutEwc = await channelsForTournament({
    gameSlug: 'valorant',
    teams: ['Team Vitality', 'Sentinels'],
    matchExternalIds: ['Match:T-1'],
    includeEwc: false,
  });
  const noEwcHandles = withoutEwc.map((c) => `${c.platform}:${c.handle}`);
  assert.ok(!noEwcHandles.includes('youtube:tour_ewc'), 'ewc-only channel absent when not requested');
  assert.ok(noEwcHandles.includes('twitch:tour_game'), 'game-scope still present');
  assert.ok(noEwcHandles.includes('twitch:tour_team'), 'team-scope still present');
  assert.ok(noEwcHandles.includes('kick:tour_match'), 'match-scope still present');
});

test('update, deactivate, and delete', async () => {
  const ch = await createStreamChannel({ platform: 'kick', handle: 'editme', scope: 'ewc', label: 'Before' });
  const updated = await updateStreamChannel(ch.id, { label: 'After', language: 'ar' });
  assert.equal(updated.label, 'After');
  assert.equal(updated.language, 'ar');

  await setStreamChannelActive(ch.id, false);
  assert.equal((await getStreamChannel(ch.id)).active, false);

  const { deleted } = await deleteStreamChannel(ch.id);
  assert.equal(deleted, 1);
  assert.equal(await getStreamChannel(ch.id), null);
});

test('listDistinctActiveHandles returns one entry per platform+handle for the poller', async () => {
  const handles = await listDistinctActiveHandles();
  // val_caster was added at two scopes but is one distinct platform+handle.
  assert.equal(handles.filter((h) => h.handle === 'val_caster' && h.platform === 'twitch').length, 1);
  assert.ok(handles.every((h) => h.platform && h.handle));
});

test('syncLiquipediaBroadcasters imports official streams, prunes dropped, leaves admin rows', async () => {
  const extId = 'counterstrike/Esports_World_Cup/2099';
  const tag = `liquipedia:${extId}`;

  // An admin-added game channel that must never be pruned by the importer.
  await createStreamChannel({
    platform: 'twitch', handle: 'admin_chan', scope: 'game', gameSlug: 'counterstrike', addedBy: 'discord:123',
  });

  const first = await syncLiquipediaBroadcasters({
    externalId: extId,
    gameSlug: 'counterstrike',
    streams: [
      { platform: 'twitch', handle: 'ewc_cs' },
      { platform: 'twitch', handle: 'EWC_CS_FR' }, // mixed case → normalized
      { platform: 'kick', handle: 'partner' },
      { platform: 'youtube', handle: 'ignored' }, // not a tracked platform → skipped
    ],
  });
  assert.equal(first.kept, 3);
  assert.equal(first.removed, 0);

  const imported = (await listStreamChannels({ scope: 'game', activeOnly: true }))
    .filter((c) => c.addedBy === tag)
    .map((c) => `${c.platform}:${c.handle}`)
    .sort();
  assert.deepEqual(imported, ['kick:partner', 'twitch:ewc_cs', 'twitch:ewc_cs_fr']);

  // Re-sync with EWC_CS_FR dropped → it is deactivated, the rest kept.
  const second = await syncLiquipediaBroadcasters({
    externalId: extId,
    gameSlug: 'counterstrike',
    streams: [
      { platform: 'twitch', handle: 'ewc_cs' },
      { platform: 'kick', handle: 'partner' },
    ],
  });
  assert.equal(second.kept, 2);
  assert.equal(second.removed, 1);

  const active = await listStreamChannels({ scope: 'game', activeOnly: true });
  const stillImported = active.filter((c) => c.addedBy === tag).map((c) => `${c.platform}:${c.handle}`).sort();
  assert.deepEqual(stillImported, ['kick:partner', 'twitch:ewc_cs']);
  // The admin row is untouched (still active, original provenance).
  assert.ok(active.some((c) => c.handle === 'admin_chan' && c.addedBy === 'discord:123'));
});
