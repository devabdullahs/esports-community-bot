function cleanTitlePart(part) {
  return decodeURIComponent(String(part ?? ''))
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

// Normalize a user-supplied tournament identifier into { source, externalId, game, url, name }.
// Accepts:
//   Liquipedia URL : https://liquipedia.net/valorant/VCT/2024/Champions
//   Start.gg URL   : https://www.start.gg/tournament/<slug>/...
//                    https://www.start.gg/tournament/<slug>/event/<event-slug>
//   PandaScore ID  : 12345            (bare numeric)
//   Explicit form  : pandascore:12345 | startgg:<slug> | liquipedia:<game>/<Page>
// Returns null when nothing matches.
export function parseTournamentInput(raw) {
  const input = String(raw ?? '').trim();
  if (!input) return null;

  // Liquipedia URL -> capture <game> and the page path after it.
  const lp = input.match(/liquipedia\.net\/([^/]+)\/(.+?)\/?(?:[?#].*)?$/i);
  if (lp) {
    const game = lp[1].toLowerCase();
    const page = decodeURIComponent(lp[2]);
    return {
      source: 'liquipedia',
      game,
      externalId: `${game}/${page}`,
      url: input,
      name: formatLiquipediaPageTitle(page),
    };
  }

  // Start.gg tournament/event URL -> capture the tournament slug, and preserve
  // an event slug when one is supplied so a single Evo game does not import
  // every event under the broader tournament.
  const sg = input.match(/start\.gg\/tournament\/([^/?#]+)(?:\/event\/([^/?#]+))?/i);
  if (sg) {
    const externalId = sg[2] ? `tournament/${sg[1]}/event/${sg[2]}` : sg[1];
    const tournamentName = cleanStartggTitlePart(sg[1]);
    const eventName = sg[2] ? cleanStartggTitlePart(sg[2]) : null;
    return {
      source: 'startgg',
      game: null,
      externalId,
      url: input,
      name: eventName ? `${tournamentName}: ${eventName}` : tournamentName,
    };
  }

  // Explicit "source:id" form.
  const explicit = input.match(/^(pandascore|startgg|liquipedia):(.+)$/i);
  if (explicit) {
    const source = explicit[1].toLowerCase();
    const id = explicit[2].trim();
    return {
      source,
      game: source === 'liquipedia' ? id.split('/')[0].toLowerCase() : null,
      externalId: id,
      url: null,
      name: source === 'liquipedia' ? formatLiquipediaPageTitle(id.split('/').slice(1).join('/')) : id,
    };
  }

  // Bare numeric -> PandaScore tournament/serie id.
  if (/^\d+$/.test(input)) {
    return { source: 'pandascore', game: null, externalId: input, url: null, name: `PandaScore #${input}` };
  }

  return null;
}
