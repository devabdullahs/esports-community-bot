// Entity (team/player) fetch orchestrators: resolve a name to a wiki page via
// the throttled search queue, then parse the page via the throttled parse queue.
// Every request goes through client.js — never a parallel HTTP path.

import * as cheerio from 'cheerio';
import { normalizeTeamName } from '../../lib/render.js';
import { parsePage, searchPagesStrict } from './client.js';
import { findTeamRosterTable, normalizeEntityFacts, parseEntityInfobox, parseTeamRoster } from './entityParsers.js';

// Tournament game slug -> Liquipedia wiki. Only listed games are enriched; the
// battle-royale wikis and TFT are the headline additions (PandaScore has no
// entity data for them). Aliases collapse onto their wiki (warzone lives under
// callofduty, cs2 under counterstrike).
const GAME_WIKIS = {
  apexlegends: 'apexlegends',
  callofduty: 'callofduty',
  counterstrike: 'counterstrike',
  cs2: 'counterstrike',
  dota2: 'dota2',
  easportsfc: 'easportsfc',
  fifa: 'easportsfc',
  fortnite: 'fortnite',
  freefire: 'freefire',
  leagueoflegends: 'leagueoflegends',
  mobilelegends: 'mobilelegends',
  overwatch: 'overwatch',
  pubg: 'pubg',
  pubgmobile: 'pubgmobile',
  rainbowsix: 'rainbowsix',
  rocketleague: 'rocketleague',
  tft: 'tft',
  valorant: 'valorant',
  warzone: 'callofduty',
};

export function wikiForGame(game) {
  return GAME_WIKIS[String(game ?? '').trim().toLowerCase()] ?? null;
}

export function pageFromUrl(url) {
  try {
    const path = new URL(url).pathname;
    const segments = path.split('/').filter(Boolean);
    return segments.length >= 2 ? decodeURIComponent(segments.slice(1).join('/')) : null;
  } catch {
    return null;
  }
}

// Conservative name -> page resolution: only an exact normalized-title match
// wins (the spike measured 15/15 on real tracked LoL teams with exactly this
// rule). The status matters to the caller: 'no-match' is durable (the search
// SUCCEEDED and nothing matched — stamp it for the TTL), while 'transient'
// means the search itself failed (rate-limit backoff, HTTP error, full queue)
// — never stamp that as a 30-day miss, just retry next run.
export async function resolveEntityPage(wiki, name) {
  const target = normalizeTeamName(name);
  if (!wiki || !target) return { status: 'no-match' };
  const { ok, results } = await searchPagesStrict(wiki, name, 6);
  if (!ok) return { status: 'transient' };
  const hit = results.find((r) => normalizeTeamName(r.title) === target);
  if (!hit) return { status: 'no-match' };
  return {
    status: 'ok',
    title: hit.title,
    page: pageFromUrl(hit.url) ?? hit.title.replace(/ /g, '_'),
    url: hit.url,
  };
}

async function loadEntityPage(wiki, page) {
  const data = await parsePage(wiki, page);
  const html = data?.parse?.text?.['*'];
  if (!html) return null;
  return cheerio.load(html);
}

// Fetch + parse one team page. Returns null when the page has no infobox (a
// disambiguation or unexpected page — safer to store nothing than garbage).
// `raw` keeps only the fragments we parse (infobox + first roster table), so
// facts can be re-extracted later without another Liquipedia request.
export async function fetchTeamEntity(wiki, page) {
  const $ = await loadEntityPage(wiki, page);
  if (!$) return null;
  const infobox = parseEntityInfobox($);
  if (!infobox) return null;
  const { players: roster, truncated: rosterTruncated } = parseTeamRoster($);
  const rosterTable = findTeamRosterTable($);
  const raw = [
    $.html($('.fo-nttax-infobox').first()),
    rosterTable ? $.html(rosterTable) : '',
  ].filter(Boolean).join('\n');
  return {
    name: infobox.name,
    image: infobox.image,
    facts: infobox.facts,
    normalized: normalizeEntityFacts(infobox.facts),
    roster,
    rosterTruncated,
    raw,
  };
}

export async function fetchPlayerEntity(wiki, page) {
  const $ = await loadEntityPage(wiki, page);
  if (!$) return null;
  const infobox = parseEntityInfobox($);
  if (!infobox) return null;
  const raw = $.html($('.fo-nttax-infobox').first()) || '';
  return {
    name: infobox.name,
    image: infobox.image,
    facts: infobox.facts,
    normalized: normalizeEntityFacts(infobox.facts),
    raw,
  };
}
