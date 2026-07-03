export function logoProxyUrl(value: string): string {
  return `/api/logo?url=${encodeURIComponent(value.trim())}`;
}

// True only for URLs the logo cache/proxy will actually accept: https on the
// exact liquipedia.net host. This MUST mirror isAllowedLogoUrl in the bot's
// logoSource.js — proxying anything the cache rejects would 400 and break the
// image. (Can't import that here: this module is used by client components.)
export function isProxiableLogoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.toLowerCase() === "liquipedia.net";
  } catch {
    return false;
  }
}

// Liquipedia forbids hotlinking its images, so anything hosted there must go
// through our caching proxy (/api/logo serves only the bot-warmed on-disk
// cache). Other hosts (PandaScore's CDN) are served as-is.
export function displayImageUrl(value: string): string {
  return isProxiableLogoUrl(value) ? logoProxyUrl(value) : value;
}
