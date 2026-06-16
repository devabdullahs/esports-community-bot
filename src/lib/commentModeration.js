// Comment moderation helpers: text normalization (Arabic + English), a
// profanity/slur match, and a configurable safe-link allowlist. Pure functions
// so they unit-test without a DB or network (tests/commentModeration.test.mjs).
//
// Matching is whole-word (letter-bounded) on a NORMALIZED copy of the text so
// common evasions (diacritics, tatweel, zero-width chars, leetspeak, stretched
// letters) are caught without the classic "Scunthorpe" false positives.

// --- normalization ----------------------------------------------------------

// Bidi controls + zero-width joiners/spaces used to hide letters.
const ZERO_WIDTH = /[​-‏‪-‮⁠-⁤﻿]/g;
// Arabic harakat / tashkeel and other combining marks.
const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭ]/g;
const TATWEEL = /ـ/g;

const LEET = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g',
  '@': 'a', '$': 's', '!': 'i', '|': 'i',
};

function stripZeroWidth(s) {
  return s.replace(ZERO_WIDTH, '');
}

// Fold the common Arabic letter variants writers use interchangeably so a single
// list entry catches all spellings.
function foldArabicLetters(s) {
  return s
    .replace(/[آأإٱ]/g, 'ا') // آ أ إ ٱ -> ا
    .replace(/ى/g, 'ي') // ى -> ي
    .replace(/ئ/g, 'ي') // ئ -> ي
    .replace(/ة/g, 'ه') // ة -> ه
    .replace(/ؤ/g, 'و'); // ؤ -> و
}

function deLeet(s) {
  return s.replace(/[0134578 9@$!|]/g, (c) => LEET[c] ?? c);
}

// Collapse a run of THREE OR MORE identical chars to one ("loooove" -> "love"),
// but leave genuine doubles ("ass", "class") intact so they don't collide.
function collapseRepeats(s) {
  return s.replace(/(.)\1{2,}/gu, '$1');
}

export function normalizeForMatch(text) {
  let s = String(text ?? '');
  s = stripZeroWidth(s);
  s = s.replace(ARABIC_DIACRITICS, '').replace(TATWEEL, '');
  s = foldArabicLetters(s);
  s = s.toLowerCase();
  s = deLeet(s);
  s = collapseRepeats(s);
  return s;
}

// --- profanity / slur list --------------------------------------------------

// Deliberately a modest, unambiguous starter set (English + Arabic). Extend as
// needed; entries are normalized the same way the input is before matching.
const BAD_WORDS = [
  // English
  'fuck', 'fucker', 'motherfucker', 'shit', 'bullshit', 'bitch', 'ass', 'asshole',
  'bastard', 'dickhead', 'cunt', 'slut', 'whore', 'faggot', 'retard', 'nigger',
  'pussy', 'jerk off', 'cock',
  // Arabic (common insults/profanity)
  'كس', 'كسم', 'كسمك', 'زب', 'زبي', 'طيز', 'شرموط', 'شرموطه', 'عرص', 'منيوك',
  'خول', 'متناك', 'لعنه', 'ابن المتناكه', 'ابن الشرموطه', 'يا حيوان', 'كلب',
  'حقير', 'غبي',
];

const NORMALIZED_BAD_WORDS = [...new Set(BAD_WORDS.map(normalizeForMatch).filter(Boolean))];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Letter-bounded match that tolerates a small set of inflectional suffixes, so
// "fuck" also catches "fucking"/"fucker"/"fucks" while "ass" still flags alone
// without false-positiving on "assist"/"assume" (whose tails aren't suffixes)
// or "class"/"pass" (the word isn't at a boundary).
const SUFFIX = '(?:ing|ers|ies|es|ed|er|in|s|y)?';
export function findProfanity(text) {
  const normalized = normalizeForMatch(text);
  const hits = [];
  for (const word of NORMALIZED_BAD_WORDS) {
    const re = new RegExp(`(?:^|[^\\p{L}])${escapeRegExp(word)}${SUFFIX}(?:[^\\p{L}]|$)`, 'u');
    if (re.test(normalized)) hits.push(word);
  }
  return hits;
}

// --- link allowlist ---------------------------------------------------------

// The safe-link allowlist baseline. Always present; env COMMENT_ALLOWED_LINK_HOSTS
// extends (never replaces) it so the defaults can't be lost by misconfiguration.
export const DEFAULT_ALLOWED_LINK_HOSTS = [
  'esportscommunity.net',
  'x.com', 'twitter.com', 'instagram.com', 'youtube.com', 'youtu.be',
  'twitch.tv', 'sooplive.com', 'tiktok.com',
  'liquipedia.net', 'hltv.org', 'vlr.gg', 'blast.tv', 'start.gg', 'faceit.com',
  'battlefy.com', 'challonge.com', 'escharts.com', 'gosugamers.net',
  'esportsearnings.com', 'tracker.gg', 'op.gg', 'u.gg',
];

function bareHost(h) {
  return String(h ?? '').trim().replace(/^www\./, '').toLowerCase();
}

export function allowedLinkHosts(envValue = process.env.COMMENT_ALLOWED_LINK_HOSTS) {
  const set = new Set(DEFAULT_ALLOWED_LINK_HOSTS.map(bareHost));
  for (const h of String(envValue ?? '').split(',').map(bareHost).filter(Boolean)) {
    set.add(h);
  }
  return set;
}

export function isAllowedLinkHost(host, allowed = allowedLinkHosts()) {
  const h = bareHost(host);
  if (!h) return false;
  for (const a of allowed) {
    if (h === a || h.endsWith(`.${a}`)) return true;
  }
  return false;
}

const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"')\]]+)/gi;

export function extractLinks(text) {
  const out = [];
  const seen = new Set();
  for (const match of String(text ?? '').matchAll(URL_RE)) {
    const raw = match[1].replace(/[.,;:!?)]+$/, ''); // drop trailing punctuation
    const urlStr = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const url = new URL(urlStr);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      const host = bareHost(url.hostname);
      const key = `${host}${url.pathname}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ raw, host, url: url.toString() });
    } catch {
      // Not a parseable URL — ignore.
    }
  }
  return out;
}

// --- combined analysis ------------------------------------------------------

/**
 * Analyze a comment body. The caller decides status from the result:
 *  - hasProfanity  -> pending, NEVER auto-approve (a moderator must review).
 *  - hasExternalLinks (and no profanity) -> pending, link-only (auto-approve
 *    after the timeout if no moderator acts).
 *  - neither       -> visible.
 */
export function analyzeCommentText(body, { allowed = allowedLinkHosts() } = {}) {
  const profanity = findProfanity(body);
  const links = extractLinks(body);
  const externalLinks = links.filter((l) => !isAllowedLinkHost(l.host, allowed));
  return {
    profanity,
    hasProfanity: profanity.length > 0,
    links: links.map((l) => l.url),
    externalLinks: externalLinks.map((l) => l.host),
    hasExternalLinks: externalLinks.length > 0,
  };
}
