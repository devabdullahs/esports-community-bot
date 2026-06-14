export function logoProxyUrl(value: string): string {
  return `/api/logo?url=${encodeURIComponent(value.trim())}`;
}
