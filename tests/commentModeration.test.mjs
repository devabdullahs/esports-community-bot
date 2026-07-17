import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeForMatch,
  findProfanity,
  findReviewTerms,
  isAllowedLinkHost,
  allowedLinkHosts,
  extractLinks,
  findKeywordRules,
  analyzeCommentText,
} from '../src/lib/commentModeration.js';

// --- normalization ----------------------------------------------------------

test('normalization: Arabic diacritics and tatweel are removed', () => {
  assert.equal(normalizeForMatch('كُسْ'), normalizeForMatch('كس'));
  assert.equal(normalizeForMatch('كــس'), 'كس'); // tatweel stripped
});

test('normalization: zero-width characters are removed', () => {
  assert.equal(normalizeForMatch('ك​س'), 'كس');
  assert.equal(normalizeForMatch('fu​ck'), 'fuck');
});

test('normalization: Arabic letter variants are folded', () => {
  assert.equal(normalizeForMatch('أحمد'), normalizeForMatch('احمد')); // أ/ا
  assert.equal(normalizeForMatch('مدرسة'), normalizeForMatch('مدرسه')); // ة/ه
  assert.equal(normalizeForMatch('مصطفى'), normalizeForMatch('مصطفي')); // ى/ي
});

test('normalization: 3+ stretched letters collapse, genuine doubles survive', () => {
  assert.equal(normalizeForMatch('loooove'), 'love');
  assert.equal(normalizeForMatch('shiiiit'), 'shit');
  // doubles must NOT collapse, or "class"/"pass"/"ass" would collide
  assert.equal(normalizeForMatch('class'), 'class');
  assert.equal(normalizeForMatch('pass'), 'pass');
});

test('normalization: Arabizi digits 3/5/6/7 are NOT de-leeted (they are letters)', () => {
  assert.equal(normalizeForMatch('3rs'), '3rs');
  assert.equal(normalizeForMatch('7mar'), '7mar');
  assert.equal(normalizeForMatch('5awal'), '5awal');
  assert.equal(normalizeForMatch('6eez'), '6eez');
  // English leet still applies
  assert.equal(normalizeForMatch('sh1t'), 'shit');
  assert.equal(normalizeForMatch('a$$'), 'ass');
});

// --- hard profanity ---------------------------------------------------------

test('hard: English profanity and slurs are flagged', () => {
  assert.ok(findProfanity('you are a fucking idiot').length > 0);
  assert.ok(findProfanity('this is shit').length > 0);
  assert.ok(findProfanity('what the cunt').length > 0);
  assert.ok(findProfanity('stop being a faggot').length > 0); // slur
  assert.equal(findProfanity('great match, well played!').length, 0);
});

test('hard: Arabic + Gulf profanity is flagged', () => {
  assert.ok(findProfanity('كس').length > 0);
  assert.ok(findProfanity('يا خول').length > 0);
  assert.ok(findProfanity('انت شرموط').length > 0);
  assert.ok(findProfanity('يا عرص').length > 0);
});

test('hard: Arabic family insults are flagged', () => {
  assert.ok(findProfanity('يا ابن الشرموطة').length > 0);
  assert.ok(findProfanity('ابن القحبة').length > 0);
});

test('hard: Arabizi variants are flagged', () => {
  assert.ok(findProfanity('kosomak').length > 0);
  assert.ok(findProfanity('3rs').length > 0); // عرص
  assert.ok(findProfanity('5awal').length > 0); // خول
  assert.ok(findProfanity('6eez').length > 0); // طيز
});

test('hard: self-harm harassment phrases are flagged', () => {
  assert.ok(findProfanity('just go kill yourself').length > 0);
  assert.ok(findProfanity('kys loser').length > 0);
  assert.ok(findProfanity('drink bleach').length > 0);
});

// --- evasion ----------------------------------------------------------------

test('evasion: separated letters (dots / spaces / hyphens) are caught', () => {
  assert.ok(findProfanity('f.u.c.k').length > 0);
  assert.ok(findProfanity('f u c k').length > 0);
  assert.ok(findProfanity('f-u-c-k').length > 0);
});

test('evasion: separated Arabic letters are caught', () => {
  assert.ok(findProfanity('ك س م ك').length > 0);
  assert.ok(findProfanity('ك-س-م-ك').length > 0);
});

test('evasion: zero-width, tatweel and stretched letters are caught', () => {
  assert.ok(findProfanity('fu​ck').length > 0); // zero-width
  assert.ok(findProfanity('كــس').length > 0); // tatweel
  assert.ok(findProfanity('shiiiit').length > 0); // stretched
  assert.ok(findProfanity('fuuuck').length > 0);
});

// --- false positives --------------------------------------------------------

test('false positives: English Scunthorpe substrings do not flag', () => {
  // "ass" is a REVIEW term, never hard
  assert.equal(findProfanity('what an ass').length, 0);
  // and neither hard nor review fires on these innocent words
  for (const finder of [findProfanity, findReviewTerms]) {
    assert.equal(finder('great class today, you pass, assist them').length, 0);
    assert.equal(finder('my assistant booked a classic seat').length, 0);
    assert.equal(finder('as soon as possible').length, 0);
  }
  // "cock" must not fire inside peacock / cocktail
  assert.equal(findProfanity('a peacock and a cocktail').length, 0);
  // "hell" must not fire inside hello / shell
  assert.equal(findReviewTerms('hello there, nice shell script').length, 0);
});

test('false positives: innocent Arabic words containing bad substrings do not flag', () => {
  // مكسور ("broken") contains كس; تكساس ("Texas") contains كس — both bounded out
  assert.equal(findProfanity('الكاس مكسور').length, 0);
  assert.equal(findProfanity('فريق من تكساس').length, 0);
  assert.equal(findProfanity('مباراة رائعة احسنتم').length, 0);
});

// --- review terms -----------------------------------------------------------

test('review: soft insults are review-only, not hard profanity', () => {
  const r = analyzeCommentText('you are an idiot and a noob');
  assert.equal(r.hasProfanity, false);
  assert.equal(r.hasReviewTerms, true);
  assert.equal(r.needsReview, true);
});

test('review: ambiguous Arabic insults route to review, not hard', () => {
  const r = analyzeCommentText('يا غبي يا كلب');
  assert.equal(r.hasProfanity, false);
  assert.equal(r.hasReviewTerms, true);
  assert.equal(r.needsReview, true);
});

test('review: "ass" / leetspeak "a$$" are review terms', () => {
  assert.ok(findReviewTerms('what an ass').length > 0);
  assert.ok(findReviewTerms('a$$').length > 0);
  assert.equal(findProfanity('what an ass').length, 0);
});

test('hard profanity sets hasProfanity AND needsReview', () => {
  const r = analyzeCommentText('this is shit');
  assert.equal(r.hasProfanity, true);
  assert.equal(r.hasReviewTerms, false);
  assert.equal(r.needsReview, true);
});

// --- link allowlist (behavior preserved) ------------------------------------

test('links: allowed social/esports hosts and subdomains pass; untrusted do not', () => {
  const allowed = allowedLinkHosts('');
  for (const host of ['youtube.com', 'youtu.be', 'x.com', 'twitch.tv', 'liquipedia.net', 'vlr.gg', 'op.gg', 'esportscommunity.net']) {
    assert.ok(isAllowedLinkHost(host, allowed), `${host} should be allowed`);
  }
  assert.ok(isAllowedLinkHost('m.youtube.com', allowed)); // subdomain
  assert.ok(isAllowedLinkHost('www.twitch.tv', allowed));
  assert.equal(isAllowedLinkHost('evil-phishing.example', allowed), false);
  assert.equal(isAllowedLinkHost('bit.ly', allowed), false);
});

test('links: env extends (never replaces) the default allowlist', () => {
  const allowed = allowedLinkHosts('my-clan.gg, www.foo.test');
  assert.ok(isAllowedLinkHost('my-clan.gg', allowed));
  assert.ok(isAllowedLinkHost('foo.test', allowed));
  assert.ok(isAllowedLinkHost('youtube.com', allowed), 'defaults still present');
});

test('links: extractLinks parses http(s) + bare www and strips trailing punctuation', () => {
  const links = extractLinks('see https://vlr.gg/123 and www.youtube.com/watch?v=x.');
  const hosts = links.map((l) => l.host);
  assert.ok(hosts.includes('vlr.gg'));
  assert.ok(hosts.includes('youtube.com'));
});

// --- combined analysis ------------------------------------------------------

test('analyze: clean text with an allowed link is visible-eligible', () => {
  const r = analyzeCommentText('nice play, check https://youtube.com/watch?v=abc');
  assert.equal(r.hasProfanity, false);
  assert.equal(r.hasReviewTerms, false);
  assert.equal(r.hasExternalLinks, false);
  assert.equal(r.needsReview, false);
});

test('analyze: external link makes needsReview true (no profanity)', () => {
  const r = analyzeCommentText('join here https://sketchy-site.example/giveaway');
  assert.equal(r.hasProfanity, false);
  assert.equal(r.hasExternalLinks, true);
  assert.deepEqual(r.externalLinks, ['sketchy-site.example']);
  assert.equal(r.needsReview, true);
});

test('analyze: profanity is detected even alongside an allowed link', () => {
  const r = analyzeCommentText('this is shit, see https://youtube.com/abc');
  assert.equal(r.hasProfanity, true);
  assert.equal(r.hasExternalLinks, false, 'youtube is allowed');
  assert.equal(r.needsReview, true);
});

test('analyze: backward-compatible fields are still present', () => {
  const r = analyzeCommentText('hello world');
  for (const key of ['profanity', 'hasProfanity', 'links', 'externalLinks', 'hasExternalLinks']) {
    assert.ok(key in r, `missing legacy field ${key}`);
  }
});

// --- admin keyword watchlist ------------------------------------------------

test('keyword watchlist: global and locale/scope-specific literal rules match conservatively', () => {
  const rules = [
    { id: 1, phrase: 'spoiler', phraseNormalized: 'spoiler', locale: 'all', scope: 'global', action: 'flag', enabled: true },
    { id: 2, phrase: 'leak', phraseNormalized: 'leak', locale: 'en', scope: 'news', action: 'hold', enabled: true },
    { id: 3, phrase: 'disabled', phraseNormalized: 'disabled', locale: 'all', scope: 'global', action: 'hold', enabled: false },
  ];
  const newsEnglish = findKeywordRules('SPOILER and leak', rules, { locales: ['en'], scope: 'news' });
  assert.deepEqual(newsEnglish.map((rule) => rule.id), [1, 2]);

  const matchEnglish = findKeywordRules('spoiler and leak', rules, { locales: ['en'], scope: 'match' });
  assert.deepEqual(matchEnglish.map((rule) => rule.id), [1]);

  const newsArabic = findKeywordRules('spoiler and leak', rules, { locales: ['ar'], scope: 'news' });
  assert.deepEqual(newsArabic.map((rule) => rule.id), [1]);
});

test('keyword watchlist: analysis reports flag and hold matches separately', () => {
  const rules = [
    { id: 1, phrase: 'spoiler', locale: 'all', scope: 'global', action: 'flag', enabled: true },
    { id: 2, phrase: 'leak', locale: 'en', scope: 'news', action: 'hold', enabled: true },
  ];
  const r = analyzeCommentText('spoiler leak', { keywordRules: rules, locales: ['en'], scope: 'news' });
  assert.equal(r.hasKeywordFlag, true);
  assert.equal(r.hasKeywordHold, true);
  assert.deepEqual(r.keywordRules.map((rule) => rule.phrase), ['spoiler', 'leak']);
});
