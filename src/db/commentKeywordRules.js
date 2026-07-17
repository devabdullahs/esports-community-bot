import { all, get, run } from './client.js';
import { normalizeKeywordPhrase } from '../lib/commentModeration.js';

export const COMMENT_KEYWORD_RULE_MAX_LENGTH = 160;
export const COMMENT_KEYWORD_LOCALES = new Set(['all', 'en', 'ar']);
export const COMMENT_KEYWORD_SCOPES = new Set(['global', 'news', 'match']);
export const COMMENT_KEYWORD_ACTIONS = new Set(['hold', 'flag']);

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function hydrate(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    phrase: row.phrase,
    phraseNormalized: row.phrase_normalized,
    locale: row.locale,
    scope: row.scope,
    action: row.action,
    enabled: row.enabled === true || Number(row.enabled) === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validText(value) {
  const phrase = String(value ?? '').trim();
  const normalized = normalizeKeywordPhrase(phrase);
  if (!phrase || phrase.length > COMMENT_KEYWORD_RULE_MAX_LENGTH || !normalized || normalized.length > COMMENT_KEYWORD_RULE_MAX_LENGTH) {
    throw new RangeError(`Keyword phrase must be between 1 and ${COMMENT_KEYWORD_RULE_MAX_LENGTH} characters.`);
  }
  return { phrase, normalized };
}

function validEnum(value, values, label) {
  if (!values.has(value)) throw new RangeError(`Invalid keyword rule ${label}.`);
  return value;
}

export async function getCommentKeywordRule(id) {
  return hydrate(await get('SELECT * FROM comment_keyword_rules WHERE id = $1', [id]));
}

export async function listCommentKeywordRules({ enabledOnly = false } = {}) {
  const rows = await all(
    `SELECT * FROM comment_keyword_rules${enabledOnly ? ' WHERE enabled = $1' : ''}
     ORDER BY enabled DESC, created_at DESC, id DESC`,
    enabledOnly ? [1] : [],
  );
  return rows.map(hydrate);
}

export function listEnabledCommentKeywordRules() {
  return listCommentKeywordRules({ enabledOnly: true });
}

export async function createCommentKeywordRule({
  phrase,
  locale = 'all',
  scope = 'global',
  action,
  enabled = true,
  createdBy,
}) {
  const text = validText(phrase);
  validEnum(locale, COMMENT_KEYWORD_LOCALES, 'locale');
  validEnum(scope, COMMENT_KEYWORD_SCOPES, 'scope');
  validEnum(action, COMMENT_KEYWORD_ACTIONS, 'action');
  if (!createdBy) throw new RangeError('Keyword rule creator is required.');

  const now = nowText();
  const inserted = await get(
    `INSERT INTO comment_keyword_rules
       (phrase, phrase_normalized, locale, scope, action, enabled, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
     RETURNING *`,
    [text.phrase, text.normalized, locale, scope, action, enabled ? 1 : 0, createdBy, now],
  );
  return hydrate(inserted);
}

export async function updateCommentKeywordRule(id, patch) {
  const existing = await getCommentKeywordRule(id);
  if (!existing) return null;

  const text = validText(patch.phrase ?? existing.phrase);
  const locale = validEnum(patch.locale ?? existing.locale, COMMENT_KEYWORD_LOCALES, 'locale');
  const scope = validEnum(patch.scope ?? existing.scope, COMMENT_KEYWORD_SCOPES, 'scope');
  const action = validEnum(patch.action ?? existing.action, COMMENT_KEYWORD_ACTIONS, 'action');
  const enabled = typeof patch.enabled === 'boolean' ? patch.enabled : existing.enabled;

  const updated = await get(
    `UPDATE comment_keyword_rules
     SET phrase = $1, phrase_normalized = $2, locale = $3, scope = $4, action = $5, enabled = $6, updated_at = $7
     WHERE id = $8
     RETURNING *`,
    [text.phrase, text.normalized, locale, scope, action, enabled ? 1 : 0, nowText(), id],
  );
  return hydrate(updated);
}

export async function setCommentKeywordRuleEnabled(id, enabled) {
  if (typeof enabled !== 'boolean') throw new RangeError('Keyword rule enabled state must be boolean.');
  const updated = await get(
    `UPDATE comment_keyword_rules SET enabled = $1, updated_at = $2 WHERE id = $3 RETURNING *`,
    [enabled ? 1 : 0, nowText(), id],
  );
  return hydrate(updated);
}
