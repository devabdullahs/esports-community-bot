const LEGACY_PUBLIC_ASSET_HOST = 'assets.moonbot.info';
const CANONICAL_PUBLIC_ASSET_HOST = 'assets.esportscommunity.net';

export function canonicalPublicAssetUrl(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    if (url.hostname.toLowerCase() === LEGACY_PUBLIC_ASSET_HOST) {
      url.protocol = 'https:';
      url.hostname = CANONICAL_PUBLIC_ASSET_HOST;
      return url.toString();
    }
  } catch {
    return trimmed;
  }
  return trimmed;
}
