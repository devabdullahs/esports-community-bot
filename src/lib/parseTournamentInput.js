import { isKnownGameSlug, normalizeGameSlug } from './games.js';

const MAX_INPUT_CHARS = 512;
const SOURCE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.()+,'~-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.()+,'~-]*)*$/;
const STARTGG_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,127}$/;

function cleanTitlePart(part) {
  return String(part ?? '')
    .replaceAll('_', ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanStartggTitlePart(part) {
  return cleanTitlePart(part)
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function formatLiquipediaPageTitle(page) {
  const parts = String(page ?? '')
    .split('/')
    .map(cleanTitlePart)
    .filter(Boolean);
  if (!parts.length) return '';

  const [first, second, ...rest] = parts;
  if (/^\d{4}$/.test(second || '')) {
    const prefix = `${first} ${second}`;
    return rest.length ? `${prefix}: ${rest.join(' ')}` : prefix;
  }

  return parts.join(' ');
}

function safeRawInput(raw) {
  const input = String(raw ?? '').trim().replace(/^url:\s*/i, '');
  if (!input || input.length > MAX_INPUT_CHARS) return null;
  if (/[\u0000-\u001f\u007f\\%?#]/.test(input)) return null;
  return input;
}

function normalizeStartggId(value) {
  const raw = String(value || '').replace(/^tournament\//i, '');
  const parts = raw.split('/');
  if (!STARTGG_SLUG_RE.test(parts[0] || '')) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length !== 3 || parts[1].toLowerCase() !== 'event' || !STARTGG_SLUG_RE.test(parts[2])) return null;
  return `tournament/${parts[0]}/event/${parts[2]}`;
}

function normalizeLiquipediaId(value) {
  const sourceId = String(value || '');
  if (!SOURCE_ID_RE.test(sourceId)) return null;
  const [wiki, ...page] = sourceId.split('/');
  if (!wiki || !page.length || page.some((part) => part === '.' || part === '..')) return null;
  return `${wiki.toLowerCase()}/${page.join('/')}`;
}

export function canonicalTournamentUrl(source, sourceId) {
  if (source === 'liquipedia') {
    const normalized = normalizeLiquipediaId(sourceId);
    return normalized ? `https://liquipedia.net/${normalized}` : null;
  }
  if (source === 'startgg') {
    const normalized = normalizeStartggId(sourceId);
    if (!normalized) return null;
    const path = normalized.startsWith('tournament/') ? normalized : `tournament/${normalized}`;
    return `https://www.start.gg/${path}`;
  }
  return null;
}

export function normalizeTournamentOperationInput({ source, sourceId, game = null } = {}) {
  const normalizedSource = String(source || '').trim().toLowerCase();
  if (!['liquipedia', 'startgg', 'pandascore'].includes(normalizedSource)) return null;
  const normalizedGame = game ? normalizeGameSlug(String(game).trim().toLowerCase()) : null;
  if (normalizedGame && !isKnownGameSlug(normalizedGame)) return null;

  if (normalizedSource === 'pandascore') {
    const normalizedId = String(sourceId || '').trim();
    if (!/^\d{1,20}$/.test(normalizedId)) return null;
    return { source: normalizedSource, sourceId: normalizedId, game: normalizedGame, url: null };
  }
  const normalizedId =
    normalizedSource === 'liquipedia'
      ? normalizeLiquipediaId(sourceId)
      : normalizeStartggId(String(sourceId || '').toLowerCase());
  if (!normalizedId) return null;
  return {
    source: normalizedSource,
    sourceId: normalizedId,
    game: normalizedGame,
    url: canonicalTournamentUrl(normalizedSource, normalizedId),
  };
}

// Parse supported URL or explicit identifier forms into one canonical identity.
// Raw URLs are validated before URL construction so traversal, encoded
// separators, userinfo, ports, queries, and host lookalikes fail closed.
export function parseTournamentInput(raw) {
  const input = safeRawInput(raw);
  if (!input) return null;

  const lp = input.match(
    /^https:\/\/(?:www\.)?liquipedia\.net\/([a-z0-9_-]{1,64})\/([A-Za-z0-9][A-Za-z0-9_.()+,'~/-]*?)\/?$/i,
  );
  if (lp) {
    const identity = normalizeTournamentOperationInput({
      source: 'liquipedia',
      sourceId: `${lp[1]}/${lp[2]}`,
      game: lp[1],
    });
    if (!identity) return null;
    const page = identity.sourceId.split('/').slice(1).join('/');
    return {
      source: identity.source,
      game: identity.game,
      externalId: identity.sourceId,
      url: identity.url,
      name: formatLiquipediaPageTitle(page),
    };
  }

  const sg = input.match(
    /^https:\/\/(?:www\.)?start\.gg\/tournament\/([a-z0-9][a-z0-9-]{0,127})(?:\/events?\/([a-z0-9][a-z0-9-]{0,127}))?\/?$/i,
  );
  if (sg) {
    const sourceId = sg[2] ? `tournament/${sg[1]}/event/${sg[2]}` : sg[1];
    const identity = normalizeTournamentOperationInput({ source: 'startgg', sourceId });
    if (!identity) return null;
    const tournamentName = cleanStartggTitlePart(sg[1]);
    const eventName = sg[2] ? cleanStartggTitlePart(sg[2]) : null;
    return {
      source: identity.source,
      game: null,
      externalId: identity.sourceId,
      url: identity.url,
      name: eventName ? `${tournamentName}: ${eventName}` : tournamentName,
    };
  }

  const explicit = input.match(/^(pandascore|startgg|liquipedia):(.+)$/i);
  if (explicit) {
    const identity = normalizeTournamentOperationInput({
      source: explicit[1],
      sourceId: explicit[2],
      game: explicit[1].toLowerCase() === 'liquipedia' ? explicit[2].split('/')[0] : null,
    });
    if (!identity) return null;
    return {
      source: identity.source,
      game: identity.game,
      externalId: identity.sourceId,
      url: identity.url,
      name:
        identity.source === 'liquipedia'
          ? formatLiquipediaPageTitle(identity.sourceId.split('/').slice(1).join('/'))
          : identity.source === 'startgg'
            ? cleanStartggTitlePart(identity.sourceId.split('/').at(-1))
            : `PandaScore #${identity.sourceId}`,
    };
  }

  if (/^\d{1,20}$/.test(input)) {
    return {
      source: 'pandascore',
      game: null,
      externalId: input,
      url: null,
      name: `PandaScore #${input}`,
    };
  }
  return null;
}
