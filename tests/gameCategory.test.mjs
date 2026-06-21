import assert from 'node:assert/strict';
import test from 'node:test';

const { categoryToGameSlug } = await import('../src/lib/games.js');

test('categoryToGameSlug maps real Twitch/Kick categories to tracked game slugs', () => {
  // Exact name matches.
  assert.equal(categoryToGameSlug('Rocket League'), 'rocketleague');
  assert.equal(categoryToGameSlug('VALORANT'), 'valorant');
  assert.equal(categoryToGameSlug('Dota 2'), 'dota2');
  assert.equal(categoryToGameSlug('League of Legends'), 'leagueoflegends');
  assert.equal(categoryToGameSlug('Apex Legends'), 'apexlegends');
  // Version / edition suffixes the platforms add but our slugs don't.
  assert.equal(categoryToGameSlug('Overwatch 2'), 'overwatch');
  assert.equal(categoryToGameSlug('Counter-Strike 2'), 'counterstrike');
  assert.equal(categoryToGameSlug('Call of Duty: Black Ops 6'), 'callofduty');
  // Alias.
  assert.equal(categoryToGameSlug('Teamfight Tactics'), 'tft');
});

test('categoryToGameSlug returns null for off-topic / non-esports categories', () => {
  assert.equal(categoryToGameSlug('Just Chatting'), null);
  assert.equal(categoryToGameSlug('Grand Theft Auto V'), null);
  assert.equal(categoryToGameSlug('Fall Guys'), null);
  assert.equal(categoryToGameSlug(''), null);
  assert.equal(categoryToGameSlug(null), null);
  assert.equal(categoryToGameSlug(undefined), null);
});
