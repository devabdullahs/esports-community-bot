export function logoProxyUrl(value: string): string {
  return `/api/logo?url=${encodeURIComponent(value.trim())}`;
}

// Liquipedia forbids hotlinking its images, so anything hosted there must go
// through our caching proxy (/api/logo serves only the bot-warmed on-disk
// cache). Other hosts (PandaScore's CDN) are served as-is.
export function displayImageUrl(value: string): string {
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === "liquipedia.net" || host.endsWith(".liquipedia.net")) {
      return logoProxyUrl(value);
    }
  } catch {
    // Non-absolute values pass through untouched.
  }
  return value;
}
