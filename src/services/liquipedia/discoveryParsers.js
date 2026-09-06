import * as cheerio from 'cheerio';
import { normalizeTournamentOperationInput } from '../../lib/parseTournamentInput.js';

export function discoveryIdentity(href, game) {
  try {
    const url = new URL(href, 'https://liquipedia.net');
    if (url.origin !== 'https://liquipedia.net' || url.search || url.hash) return null;
    const sourceId = decodeURIComponent(url.pathname.slice(1)).replace(/ /g, '_');
    if (!sourceId.startsWith(`${game}/`)) return null;
    return normalizeTournamentOperationInput({ source: 'liquipedia', sourceId, game });
  } catch { return null; }
}

export function eligibleDiscoveryTier(value) {
  return /^(?:[SA](?:[ -]Tier)?|Tier[ -]?[12]|[12])$/i.test(String(value || '').trim());
}

// The main page's tournament cards carry their own tier badges. Never infer a
// tier from surrounding navigation, prize money, or a linked team's name.
export function parseTournamentDiscovery(html, game) {
  const $ = cheerio.load(html);
  const candidates = new Map();
  let unknownTier = 0;
  $('.tournaments-list-item, .gridRow, .divRow, tr').add($('.tournaments-list-name').parent()).each((_, row) => {
    let nameCell = $(row).find('.tournaments-list-item__name, .Tournament, .tournament-name').first();
    let tier = $(row).find('.tournament-badge__chip, .Tier, .tier').first().text().trim();
    if (!tier) tier = $(row).find('.tournament-badge__text').first().text().trim();
    if (!nameCell.length) {
      const cells = $(row).children('td, .divCell');
      const headers = $(row).closest('table').find('tr').first().children('th, td').map((_, cell) => $(cell).text().trim()).get();
      const nameIndex = headers.findIndex(text => /^tournament$/i.test(text));
      const tierIndex = headers.findIndex(text => /^tier$/i.test(text));
      if (nameIndex < 0 || tierIndex < 0) return;
      nameCell = cells.eq(nameIndex);
      tier = cells.eq(tierIndex).text().trim();
    }
    if (!tier) unknownTier++;
    if (!eligibleDiscoveryTier(tier)) return;
    nameCell.find('a[href]').each((_, link) => {
      if ($(link).hasClass('new')) return;
      const identity = discoveryIdentity($(link).attr('href'), game);
      if (!identity || /(?:^|\/)(?:Main_Page|[SA]-Tier_Tournaments|Tier_[12]_Tournaments)(?:\/|$)/.test(identity.sourceId)) return;
      candidates.set(identity.sourceId, identity);
    });
  });
  return { candidates: [...candidates.values()], unknownTier };
}
