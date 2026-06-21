// Mirrors the bot's normalization in src/db/streamChannels.js. Keep in sync.
// NO "server-only" here so client components can import these helpers.

export function normalizeCreatorKey(value: unknown): string {
  return (typeof value === "string" ? value : "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function normalizeGameSlug(value: unknown): string {
  return (typeof value === "string" ? value : "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 60);
}

export function normalizeGameSlugs(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(/[,،;|/\s]+/u)
        .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const slug = normalizeGameSlug(item);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out.slice(0, 12);
}
