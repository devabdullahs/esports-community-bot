import assert from 'node:assert/strict';
import test from 'node:test';

const { categoryToGameSlug, gameName, gameSlugFromName, searchGames } = await import('../src/lib/games.js');

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

test('fighter game aliases resolve to the canonical fighters board', () => {
  assert.equal(gameName('fighters'), 'Fighter Games');
  assert.equal(gameSlugFromName('Tekken 8'), 'fighters');
  assert.equal(gameSlugFromName('Street Fighter 6'), 'fighters');
  assert.equal(gameSlugFromName('Fatal Fury: City of the Wolves'), 'fighters');
  assert.equal(categoryToGameSlug('TEKKEN 8'), 'fighters');
});

test('fighter autocomplete exposes aliases without duplicate slug choices', () => {
  assert.deepEqual(searchGames('tekken')[0], { name: 'Tekken (Fighter Games)', value: 'fighters' });
  const fighterChoices = searchGames('fighter');
  assert.equal(fighterChoices.filter((choice) => choice.value === 'fighters').length, 1);
});
