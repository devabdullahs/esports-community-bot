/**
 * URL scheme validator shared by the admin API and the markdown renderer.
 * Allows only absolute http(s) URLs. Returns false for anything that fails to
 * parse, or that uses an unsafe scheme (javascript:, data:, vbscript:, file:, etc.).
 */
export function isSafeUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  return url.protocol === "http:" || url.protocol === "https:";
}

/** Returns the URL if safe, otherwise undefined. Handy for render-time fallbacks. */
export function safeUrlOrUndefined(value: unknown): string | undefined {
  return isSafeUrl(value) ? value.trim() : undefined;
}
