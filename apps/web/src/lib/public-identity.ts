import "server-only";

const MAX_NAME_LENGTH = 80;
const MAX_AVATAR_URL_LENGTH = 2_048;
const DISCORD_AVATAR_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

export function normalizePublicDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return normalized ? normalized : null;
}

// Better Auth's Discord provider derives avatars from cdn.discordapp.com. Keep
// this allow-list narrow because this URL is later fetched by the avatar proxy.
export function approvedDiscordAvatarUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_AVATAR_URL_LENGTH) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !DISCORD_AVATAR_HOSTS.has(url.hostname.toLowerCase())) return null;
    return url.toString();
  } catch {
    return null;
  }
}
