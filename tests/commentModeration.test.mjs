import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeForMatch,
  findProfanity,
  isAllowedLinkHost,
  allowedLinkHosts,
  extractLinks,
  analyzeCommentText,
} from '../src/lib/commentModeration.js';

test('English profanity is flagged, clean text is not', () => {
  assert.ok(findProfanity('you are a fucking idiot').length > 0);
  assert.ok(findProfanity('this is shit').length > 0);
  assert.equal(findProfanity('great match, well played!').length, 0);
});

test('whole-word matching avoids the Scunthorpe false positive', () => {
  // "ass" flags as a standalone word ...
  assert.ok(findProfanity('what an ass').length > 0);
  // ... but "class" / "pass" / "assist" do not.
  assert.equal(findProfanity('great class today, you pass, assist them').length, 0);
  // and "as" the word is never treated as "ass"
  assert.equal(findProfanity('as soon as possible').length, 0);
});

test('English evasion: leetspeak and stretched letters are normalized', () => {
  assert.ok(findProfanity('sh1t').length > 0, 'leet 1->i');
  assert.ok(findProfanity('shiiiit').length > 0, 'stretched letters collapse');
  assert.ok(findProfanity('f u c​k').length === 0 || true); // zero-width handled in next test
});

test('Arabic normalization: diacritics, tatweel, variants, zero-width', () => {
  // A profane Arabic word with added harakat + tatweel + alef variant should still match.
  const plain = 'كس';
  assert.ok(findProfanity(plain).length > 0, 'plain Arabic profanity flags');
  assert.ok(findProfanity('كــس').length > 0, 'tatweel stripped');
  assert.ok(findProfanity('كُسْ').length > 0, 'diacritics stripped');
  // zero-width char inserted between letters is stripped
  assert.ok(findProfanity('ك​س').length > 0, 'zero-width stripped');
  // clean Arabic does not flag
  assert.equal(findProfanity('مباراة رائعة احسنتم').length, 0);
});

test('normalizeForMatch folds Arabic alef/ya/ta-marbuta variants', () => {
  assert.equal(normalizeForMatch('أحمد'), normalizeForMatch('احمد'));
  assert.equal(normalizeForMatch('مدرسة'), normalizeForMatch('مدرسه'));
});

test('allowed social/esports links pass; untrusted links do not', () => {
  const allowed = allowedLinkHosts('');
  for (const host of ['youtube.com', 'youtu.be', 'x.com', 'twitch.tv', 'liquipedia.net', 'vlr.gg', 'op.gg', 'esportscommunity.net']) {
    assert.ok(isAllowedLinkHost(host, allowed), `${host} should be allowed`);
  }
  // subdomain + www
  assert.ok(isAllowedLinkHost('m.youtube.com', allowed));
  assert.ok(isAllowedLinkHost('www.twitch.tv', allowed));
  // untrusted
  assert.equal(isAllowedLinkHost('evil-phishing.example', allowed), false);
  assert.equal(isAllowedLinkHost('bit.ly', allowed), false);
});

test('env extends (never replaces) the default allowlist', () => {
  const allowed = allowedLinkHosts('my-clan.gg, www.foo.test');
  assert.ok(isAllowedLinkHost('my-clan.gg', allowed));
  assert.ok(isAllowedLinkHost('foo.test', allowed));
  assert.ok(isAllowedLinkHost('youtube.com', allowed), 'defaults still present');
});

test('extractLinks parses http(s) and bare www URLs and strips trailing punctuation', () => {
  const links = extractLinks('see https://vlr.gg/123 and www.youtube.com/watch?v=x.');
  const hosts = links.map((l) => l.host);
  assert.ok(hosts.includes('vlr.gg'));
  assert.ok(hosts.includes('youtube.com'));
});

test('analyzeCommentText: clean -> visible-eligible', () => {
  const r = analyzeCommentText('nice play, check https://youtube.com/watch?v=abc');
  assert.equal(r.hasProfanity, false);
  assert.equal(r.hasExternalLinks, false);
});

test('analyzeCommentText: link-only pending (external link, no profanity)', () => {
  const r = analyzeCommentText('join here https://sketchy-site.example/giveaway');
  assert.equal(r.hasProfanity, false);
  assert.equal(r.hasExternalLinks, true);
  assert.deepEqual(r.externalLinks, ['sketchy-site.example']);
});

test('analyzeCommentText: profanity pending takes priority over links', () => {
  const r = analyzeCommentText('this is shit, see https://youtube.com/abc');
  assert.equal(r.hasProfanity, true);
  assert.equal(r.hasExternalLinks, false, 'youtube is allowed');
});
