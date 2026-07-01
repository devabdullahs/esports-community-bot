// PandaScore nationality/location is an ISO 3166-1 alpha-2 code (e.g. "FR", "KR").
// Turn it into a flag emoji; return null for anything that isn't a 2-letter code
// so the caller can fall back to showing the raw value.
export function flagEmoji(code: string | null | undefined): string | null {
  if (!code) return null;
  const cc = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return null;
  const base = 0x1f1e6;
  return String.fromCodePoint(
    base + (cc.charCodeAt(0) - 65),
    base + (cc.charCodeAt(1) - 65),
  );
}
