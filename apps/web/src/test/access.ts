import type { AdminAccess } from "@/lib/admin";

const FAKE_SESSION = {
  user: { id: "test-user-id", name: "Test User", email: "test@example.com" },
  session: { id: "test-session-id", userId: "test-user-id", expiresAt: new Date(Date.now() + 3600000) },
} as unknown as import("@/lib/auth").Session;

/** No session — completely unauthenticated. */
export function anonymous(): AdminAccess {
  return {
    session: null,
    discordUserId: null,
    displayName: null,
    isSuper: false,
    games: [],
    media: [],
    allowed: false,
  };
}

/** Authenticated but not an admin at all. */
export function nonAdmin(): AdminAccess {
  return {
    session: FAKE_SESSION,
    discordUserId: "123456789012345678",
    displayName: "Non Admin",
    isSuper: false,
    games: [],
    media: [],
    allowed: false,
  };
}

/** Super admin — access to everything. */
export function superAdmin(): AdminAccess {
  return {
    session: FAKE_SESSION,
    discordUserId: "123456789012345678",
    displayName: "Super Admin",
    isSuper: true,
    games: "ALL",
    media: "ALL",
    allowed: true,
  };
}

/** Scoped admin with only specific game assignments. */
export function gamesAdmin(games: string[]): AdminAccess {
  return {
    session: FAKE_SESSION,
    discordUserId: "123456789012345679",
    displayName: "Games Admin",
    isSuper: false,
    games,
    media: [],
    allowed: games.length > 0,
  };
}

/** Scoped admin with only specific media channel assignments. */
export function mediaAdmin(media: string[]): AdminAccess {
  return {
    session: FAKE_SESSION,
    discordUserId: "123456789012345680",
    displayName: "Media Admin",
    isSuper: false,
    games: [],
    media,
    allowed: media.length > 0,
  };
}
