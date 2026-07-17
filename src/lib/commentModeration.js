// Comment moderation helpers: text normalization (English + Arabic + Arabizi),
// a SEVERITY-AWARE term match, and a configurable safe-link allowlist. Pure
// functions so they unit-test without a DB or network
// (tests/commentModeration.test.mjs) — moderation must stay deterministic and
// offline; there is no ML/API/runtime-fetch dependency by design.
//
// Two term lists, two outcomes:
//   - HARD_BAD_WORDS  -> hasProfanity. Explicit profanity, sexual insults,
//     discriminatory slurs, severe family/religious insults, and direct
//     self-harm harassment. The caller sends these to pending review and NEVER
//     auto-approves them.
//   - REVIEW_WORDS    -> hasReviewTerms. Softer / context-dependent insults that
//     are rude but ambiguous enough to cause false positives (e.g. "ass",
//     "كلب", "غبي"). They warrant a human glance but are not the same severity
//     as hard profanity, so they live in a separate, lower bucket.
// They are split because lumping them together either over-blocks innocent
// banter (bad UX) or waters down the "never auto-approve" guarantee for real
// abuse. needsReview = hard OR review OR external link.
//
// Matching runs on a NORMALIZED copy of the text so common evasions
// (diacritics, tatweel, zero-width chars, leetspeak, stretched/spaced letters)
// are caught without the classic "Scunthorpe" substring false positives.

// --- normalization ----------------------------------------------------------

// Bidi controls + zero-width joiners/spaces used to hide letters.
const ZERO_WIDTH = /[​-‏‪-‮⁠-⁤﻿]/g;
// Arabic harakat / tashkeel and other combining marks.
const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۤۧۨ-ۭ]/g;
const TATWEEL = /ـ/g;

// English-only leetspeak. We deliberately do NOT map 3, 5, 6, or 7 because in
// Gulf/Saudi Arabizi those ARE letters (3=ع, 5=خ, 6=ط, 7=ح); mapping them would
// corrupt Arabizi spellings and invent false positives. Arabizi forms that use
// those digits are added to the term lists explicitly instead.
const LEET = {
  '0': 'o', '1': 'i', '4': 'a', '8': 'b', '9': 'g',
  '@': 'a', '$': 's', '!': 'i', '|': 'i',
};
const LEET_RE = /[01489@$!|]/g;

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
  return s.replace(LEET_RE, (c) => LEET[c] ?? c);
}

// Collapse a run of THREE OR MORE identical chars to one ("loooove" -> "love"),
// but leave genuine doubles ("ass", "class", "pass") intact so they don't
// collide with shorter terms.
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

// --- term lists -------------------------------------------------------------

// Curated, project-owned lists (English + Arabic + Gulf/Saudi + Arabizi).
// Intentionally NOT an exhaustive dump of every dirty-word list on the internet:
// the product goal is high recall on CLEAR abuse with low false positives, not
// "block every possible word". Entries are normalized the same way input is
// before matching, so Arabizi forms using digits (3/5/6/7) are stored as written.
const HARD_BAD_WORDS = [
  // --- English: explicit profanity / sexual insults ---
  'fuck', 'motherfucker', 'fucker', 'fuckface', 'dumbfuck', 'clusterfuck',
  'shit', 'bullshit', 'cunt', 'cock', 'cocksucker', 'dickhead', 'pussy',
  'bitch', 'asshole', 'bastard', 'slut', 'whore', 'prick', 'wanker', 'twat',
  'jackoff', 'jerk off', 'jerkoff',
  // --- English: discriminatory slurs ---
  'nigger', 'nigga', 'faggot', 'retard', 'tranny', 'chink', 'spic', 'kike',
  'coon', 'dyke', 'raghead', 'towelhead', 'sandnigger', 'wetback', 'gook',
  'beaner',
  // --- English: direct self-harm harassment ---
  'kill yourself', 'kill your self', 'kill urself', 'kys', 'go kill yourself',
  'neck yourself', 'hang yourself', 'drink bleach', 'go die',
  // --- Arabic: explicit profanity / sexual insults ---
  'كس', // كس
  'كسم', // كسم
  'كسمك', // كسمك
  'زب', // زب
  'زبر', // زبر
  'طيز', // طيز
  'شرموط', // شرموط
  'شرموطة', // شرموطة
  'عرص', // عرص
  'منيوك', // منيوك
  'متناك', // متناك
  'متناكة', // متناكة
  'خول', // خول
  'قحبة', // قحبة
  'عاهرة', // عاهرة
  'نيك', // نيك
  'ينيك', // ينيك
  'منيك', // منيك
  'خرا', // خرا
  'خرة', // خرة
  'خراء', // خراء
  // --- Arabic: severe family insults ---
  'ابن الشرموطة', // ابن الشرموطة
  'ابن القحبة', // ابن القحبة
  'ابن المتناكة', // ابن المتناكة
  'ابن العاهرة', // ابن العاهرة
  // --- Arabizi (Gulf/Saudi): explicit forms. 3=ع 5=خ 6=ط 7=ح are kept as digits ---
  'kosomak', 'kosomk', 'kosom', 'kusomak', 'manyak', 'manyok', 'sharmoot',
  'sharmota', '3rs', '5awal', '6eez', 'zbr',
];

const REVIEW_WORDS = [
  // --- English: softer / contextual personal insults ---
  'ass', 'idiot', 'stupid', 'moron', 'dumb', 'loser', 'clown', 'pathetic',
  'ugly', 'hoe', 'simp', 'incel', 'noob', 'dick', 'fag', 'jerk', 'douche',
  'douchebag', 'damn', 'goddamn', 'hell', 'crap', 'screw you', 'shut up',
  // --- Arabic: milder / ambiguous insults ---
  'كلب', // كلب (dog)
  'غبي', // غبي (stupid)
  'حقير', // حقير (despicable)
  'يا حيوان', // يا حيوان (you animal)
  'حمار', // حمار (donkey)
  'بهيمة', // بهيمة (beast)
  'اهبل', // اهبل (fool)
  'هبل', // هبل (foolishness)
  'تافه', // تافه (trivial/lame)
  'زبالة', // زبالة (trash)
  'قذر', // قذر (filthy)
  'سخيف', // سخيف (silly)
  'احمق', // احمق (fool)
  'مجنون', // مجنون (crazy)
  'معتوه', // معتوه (idiot)
  'لعنة', // لعنة (curse/damn)
  'كافر', // كافر (infidel — religiously charged, contextual)
  'ابن الكلب', // ابن الكلب (son of a dog)
  'خنزير', // خنزير (pig)
  // --- Arabizi (Gulf/Saudi): milder forms ---
  '7mar', 'ghabi', 'tafeh', 'habal', 'zbala',
];

// --- matcher ----------------------------------------------------------------

// "Word" characters AFTER normalization: ASCII alphanumerics + the Arabic
// block. Numbers count as word chars so boundaries don't split Arabizi
// digit-letters (3rs, 7mar) and digits can't bridge two separate words.
//
// PERFORMANCE: this is expressed as explicit ranges, NOT \p{L}\p{N}. V8's
// Unicode-property matching is ~100x slower here — with one short comment and
// ~70 terms, the \p{}-based loose regexes took ~26s per scan (a trivial DoS).
// Explicit ranges (and dropping the `u` flag, since every char is BMP) bring a
// full scan back to single-digit milliseconds.
const WC = 'a-z0-9؀-ۿ'; // word chars: ascii alnum + Arabic block (U+0600–U+06FF)
const NWC = `[^${WC}]`; // a separator (non-word) char
const BOUNDARY_LEFT = `(?:^|${NWC})`;
const BOUNDARY_RIGHT = `(?=${NWC}|$)`;
// Small set of English inflections, so "fuck" also catches "fucking"/"fucks".
// Applied ONLY to clearly-English terms (Arabic morphology differs and adding
// these tails to Arabic roots would over-match).
const ENGLISH_SUFFIX = '(?:ing|ers|ies|es|ed|er|in|s|y)?';
const ALNUM_RE = /[a-z0-9؀-ۿ]/g;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isEnglishTerm(term) {
  return /[a-z]/.test(term) && !/[؀-ۿ]/.test(term);
}

// Build a boundary-anchored regex for one normalized term.
//   - strict (loose=false): characters are contiguous; internal spaces in a
//     phrase become a separator run, so "jerk off" also matches "jerk-off".
//   - loose  (loose=true):  a short separator run is allowed BETWEEN every
//     character, catching split evasions like "f.u.c.k", "f u c k", "f-u-c-k",
//     and "ك س م ك". Loose is intentionally NOT used for very short terms (see
//     prepareTerms) because splitting a 3-letter term matches far too eagerly.
function buildPattern(term, { loose, allowEnglishSuffixes }) {
  const innerGap = loose ? `${NWC}{1,3}` : '';
  const tokens = term.split(/\s+/).filter(Boolean);
  const tokenPatterns = tokens.map((tok) => [...tok].map(escapeRegExp).join(innerGap));
  const core = tokenPatterns.join(`${NWC}+`); // separators between phrase words
  const suffix = allowEnglishSuffixes && isEnglishTerm(term) ? ENGLISH_SUFFIX : '';
  return new RegExp(`${BOUNDARY_LEFT}${core}${suffix}${BOUNDARY_RIGHT}`);
}

// Pre-normalize + pre-compile a list once at module load.
function prepareTerms(rawTerms, { allowEnglishSuffixes, conservativeShortTerms }) {
  // Short terms are FP-prone, so only allow loose (split) matching once a term
  // is long enough that an interleaved match is unlikely to be accidental.
  const minLooseLen = conservativeShortTerms ? 5 : 4;
  const seen = new Set();
  const prepared = [];
  for (const original of rawTerms) {
    const term = normalizeForMatch(original);
    if (!term || seen.has(term)) continue;
    seen.add(term);
    const alnumLen = (term.match(ALNUM_RE) || []).length;
    prepared.push({
      original,
      strict: buildPattern(term, { loose: false, allowEnglishSuffixes }),
      loose: alnumLen >= minLooseLen ? buildPattern(term, { loose: true, allowEnglishSuffixes }) : null,
    });
  }
  return prepared;
}

const HARD_MATCHERS = prepareTerms(HARD_BAD_WORDS, {
  allowEnglishSuffixes: true,
  conservativeShortTerms: false,
});
const REVIEW_MATCHERS = prepareTerms(REVIEW_WORDS, {
  allowEnglishSuffixes: false,
  conservativeShortTerms: true,
});

// Generic term finder. Returns the ORIGINAL (pre-normalization) terms that hit,
// so flag reasons stay human-readable even for Arabizi/leet inputs.
export function findTerms(text, prepared, { allowLooseMatching = false } = {}) {
  const normalized = normalizeForMatch(text);
  const hits = [];
  for (const t of prepared) {
    if (t.strict.test(normalized)) {
      hits.push(t.original);
    } else if (allowLooseMatching && t.loose && t.loose.test(normalized)) {
      hits.push(t.original);
    }
  }
  return hits;
}

// Hard profanity / slurs / severe abuse — these must never auto-approve.
export function findProfanity(text) {
  return findTerms(text, HARD_MATCHERS, { allowLooseMatching: true });
}

// Softer / contextual insults — a moderator should glance, but lower severity.
export function findReviewTerms(text) {
  return findTerms(text, REVIEW_MATCHERS, { allowLooseMatching: true });
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

// --- admin keyword watchlist ------------------------------------------------

// Watchlist matching deliberately stays literal: a rule is a case-insensitive
// contiguous phrase, never a regex or a fuzzy/ML guess. This keeps a rule's
// effect obvious to the moderator who configured it.
export function normalizeKeywordPhrase(text) {
  return String(text ?? '').trim().normalize('NFKC').toLocaleLowerCase();
}

function ruleEnabled(rule) {
  return rule?.enabled !== false && rule?.enabled !== 0 && rule?.enabled !== '0';
}

/**
 * Return enabled literal keyword rules that apply to the supplied content.
 * `locales` may contain one or more detected content locales; global (`all`)
 * rules always apply. A target-scoped rule applies only to that target type.
 */
export function findKeywordRules(text, rules = [], { locales = ['all'], scope = 'global' } = {}) {
  const normalized = normalizeKeywordPhrase(text);
  if (!normalized) return [];
  const applicableLocales = new Set(Array.isArray(locales) ? locales : [locales]);
  return rules.filter((rule) => {
    if (!ruleEnabled(rule)) return false;
    if (rule.scope !== 'global' && rule.scope !== scope) return false;
    if (rule.locale !== 'all' && !applicableLocales.has(rule.locale)) return false;
    const phrase = rule.phraseNormalized || normalizeKeywordPhrase(rule.phrase);
    return Boolean(phrase) && normalized.includes(phrase);
  }).map((rule) => ({
    ...(rule.id == null ? {} : { id: Number(rule.id) }),
    phrase: rule.phrase,
    action: rule.action,
    locale: rule.locale,
    scope: rule.scope,
  }));
}

// --- combined analysis ------------------------------------------------------

/**
 * Analyze a comment body. The caller decides status from the result:
 *  - hasProfanity   -> pending, NEVER auto-approve (a moderator must review).
 *  - hasReviewTerms -> softer insult; reviewable but lower severity than hard
 *    profanity. The caller may queue it for review or auto-approve on a timer.
 *  - hasExternalLinks (and no profanity) -> pending, link-only (auto-approve
 *    after the timeout if no moderator acts).
 *  - needsReview    -> any of the above; convenience flag for callers.
 *  - none           -> visible.
 *
 * Backward compatible: profanity / hasProfanity / links / externalLinks /
 * hasExternalLinks keep their prior meaning; reviewTerms / hasReviewTerms /
 * needsReview are additive.
 */
export function analyzeCommentText(
  body,
  { allowed = allowedLinkHosts(), keywordRules = [], locales = ['all'], scope = 'global' } = {},
) {
  const profanity = findProfanity(body);
  const reviewTerms = findReviewTerms(body);
  const links = extractLinks(body);
  const externalLinks = links.filter((l) => !isAllowedLinkHost(l.host, allowed));
  const matchedKeywordRules = findKeywordRules(body, keywordRules, { locales, scope });
  const hasKeywordHold = matchedKeywordRules.some((rule) => rule.action === 'hold');
  const hasKeywordFlag = matchedKeywordRules.some((rule) => rule.action === 'flag');
  return {
    profanity,
    hasProfanity: profanity.length > 0,

    reviewTerms,
    hasReviewTerms: reviewTerms.length > 0,

    links: links.map((l) => l.url),
    externalLinks: externalLinks.map((l) => l.host),
    hasExternalLinks: externalLinks.length > 0,

    keywordRules: matchedKeywordRules,
    hasKeywordHold,
    hasKeywordFlag,

    needsReview: profanity.length > 0 || reviewTerms.length > 0 || externalLinks.length > 0 || matchedKeywordRules.length > 0,
  };
}
