const VERIFIED_EWC_TOURNAMENT_REFERENCES = new Set([
  'mobilelegends/mwi/2026',
  "mobilelegends/mlbb_women's_international/2026",
]);

function normalizeReference(value) {
  let text = String(value ?? '').trim();
  try {
    text = decodeURIComponent(text);
  } catch {
    // Keep malformed input inert; the exact-reference allowlist will not match it.
  }
  return text.replace(/^\/+|\/+$/g, '').toLowerCase();
}

// EWC branding is usually explicit in the page path or title. A few official
// events use their own series name instead, so those are admitted only through
// this narrow, verified reference allowlist.
export function isEwcTournamentReference(tournament) {
  if (Number(tournament?.ewc || 0) === 1) return true;
  const text = `${tournament?.external_id ?? ''} ${tournament?.url ?? ''} ${tournament?.name ?? ''}`.toLowerCase();
  if (/esports[_ ]world[_ ]cup/.test(text)) return true;
  return VERIFIED_EWC_TOURNAMENT_REFERENCES.has(normalizeReference(tournament?.external_id));
}
