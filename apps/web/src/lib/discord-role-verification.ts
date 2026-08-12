// Age, provenance, and a maximum stale age for Discord authorization data.
//
// The old cache returned the previous role array on ANY fetch exception, regardless of how
// old the entry was, so a member whose verified role had been revoked kept passing
// member-only mutation gates for as long as Discord stayed unhealthy. A generic
// stale-while-error cache is not suitable for an access decision: it has to say how old the
// evidence is, where it came from, and when it stops counting.

export const ROLE_FRESH_TTL_MS = 60_000;
/** Most one extra minute of grace beyond the fresh window, measured from the last SUCCESS. */
export const ROLE_MAX_STALE_MS = 120_000;
export const ROLE_CACHE_CAPACITY = 5_000;

export type RoleVerification =
  | { status: "verified"; roles: string[]; verifiedAt: number; source: "fresh" | "cache" | "grace" }
  | { status: "not-member"; verifiedAt: number }
  | { status: "unavailable" };

export type RoleVerificationEvent =
  | "discord-role-grace"
  | "discord-role-grace-expired"
  | "discord-role-bot-unauthorized"
  | "discord-role-cache-evicted";

type CacheEntry = {
  roles: string[] | null;
  /** Timestamp of the last SUCCESSFUL verification. Grace must never move this. */
  verifiedAt: number;
};

export type RoleVerifierOptions = {
  guildId: string;
  token: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  capacity?: number;
  /** Coarse, privacy-safe. Never receives a token, header, role list, or user ID. */
  onEvent?: (event: RoleVerificationEvent, statusClass: string) => void;
};

export type RoleVerifier = {
  verify(discordUserId: string): Promise<RoleVerification>;
  /** Test/telemetry only — the map itself is never exported. */
  size(): number;
};

export function createRoleVerifier(options: RoleVerifierOptions): RoleVerifier {
  const {
    guildId,
    token,
    fetchImpl = fetch,
    now = Date.now,
    capacity = ROLE_CACHE_CAPACITY,
    onEvent,
  } = options;

  const cache = new Map<string, CacheEntry>();
  // One warning per class per window, so a Discord outage cannot turn every request into a
  // log line.
  const lastEmitted = new Map<string, number>();

  function emit(event: RoleVerificationEvent, statusClass: string) {
    if (!onEvent) return;
    const key = `${event}:${statusClass}`;
    const at = now();
    if (at - (lastEmitted.get(key) ?? Number.NEGATIVE_INFINITY) < ROLE_FRESH_TTL_MS) return;
    lastEmitted.set(key, at);
    onEvent(event, statusClass);
  }

  function remember(discordUserId: string, entry: CacheEntry) {
    cache.set(discordUserId, entry);
    if (cache.size <= capacity) return;
    // Deterministic and synchronous: expired entries first, then oldest. No background timer.
    const at = now();
    for (const [key, value] of cache) {
      if (cache.size <= capacity) break;
      if (at - value.verifiedAt >= ROLE_MAX_STALE_MS) cache.delete(key);
    }
    while (cache.size > capacity) {
      let oldestKey: string | null = null;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [key, value] of cache) {
        if (value.verifiedAt < oldestAt) {
          oldestAt = value.verifiedAt;
          oldestKey = key;
        }
      }
      if (oldestKey == null) break;
      cache.delete(oldestKey);
    }
    emit("discord-role-cache-evicted", "capacity");
  }

  function fromEntry(entry: CacheEntry, source: "cache" | "grace"): RoleVerification {
    if (entry.roles === null) return { status: "not-member", verifiedAt: entry.verifiedAt };
    return { status: "verified", roles: entry.roles, verifiedAt: entry.verifiedAt, source };
  }

  async function verify(discordUserId: string): Promise<RoleVerification> {
    const cached = cache.get(discordUserId);
    const age = cached ? now() - cached.verifiedAt : Number.POSITIVE_INFINITY;
    if (cached && age < ROLE_FRESH_TTL_MS) return fromEntry(cached, "cache");

    let response: Response;
    try {
      response = await fetchImpl(
        `https://discord.com/api/v10/guilds/${guildId}/members/${discordUserId}`,
        { headers: { Authorization: `Bot ${token}` } },
      );
    } catch {
      return afterTransientFailure(discordUserId, cached, age, "network");
    }

    // A definitive answer from Discord always replaces cached authorization, and never uses
    // grace: 404 means "not in the guild", 401/403 means this application cannot verify at
    // all, which is a configuration failure rather than a reason to trust an old allow.
    if (response.status === 404) {
      const entry: CacheEntry = { roles: null, verifiedAt: now() };
      remember(discordUserId, entry);
      return { status: "not-member", verifiedAt: entry.verifiedAt };
    }
    if (response.status === 401 || response.status === 403) {
      cache.delete(discordUserId);
      emit("discord-role-bot-unauthorized", String(response.status));
      return { status: "unavailable" };
    }
    if (response.status === 429 || response.status >= 500) {
      return afterTransientFailure(discordUserId, cached, age, String(response.status));
    }
    if (!response.ok) {
      cache.delete(discordUserId);
      return { status: "unavailable" };
    }

    let roles: string[];
    try {
      const member = (await response.json()) as { roles?: string[] };
      if (!Array.isArray(member.roles)) throw new Error("malformed");
      roles = member.roles.filter((role): role is string => typeof role === "string");
    } catch {
      // A response we cannot parse is not evidence of membership.
      cache.delete(discordUserId);
      emit("discord-role-grace-expired", "malformed");
      return { status: "unavailable" };
    }

    const entry: CacheEntry = { roles, verifiedAt: now() };
    remember(discordUserId, entry);
    return { status: "verified", roles, verifiedAt: entry.verifiedAt, source: "fresh" };
  }

  function afterTransientFailure(
    discordUserId: string,
    cached: CacheEntry | undefined,
    age: number,
    statusClass: string,
  ): RoleVerification {
    if (cached && age <= ROLE_MAX_STALE_MS) {
      // Serve the ORIGINAL timestamp untouched. Refreshing it here would let one failure
      // every two minutes extend an authorization forever.
      emit("discord-role-grace", statusClass);
      return fromEntry(cached, "grace");
    }
    if (cached) cache.delete(discordUserId);
    emit("discord-role-grace-expired", statusClass);
    return { status: "unavailable" };
  }

  return { verify, size: () => cache.size };
}
