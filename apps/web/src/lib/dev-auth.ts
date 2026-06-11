import "server-only";

import type { Session } from "@/lib/auth";

const DEFAULT_DEV_AUTH_USER_ID = "dev-local-auth-user";
const DEFAULT_DEV_DISCORD_USER_ID = "100000000000000001";

export function isDevAuthBypassEnabled() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.EWC_DASHBOARD_DEV_AUTH_BYPASS === "true"
  );
}

export function devAuthUserId() {
  return process.env.EWC_DASHBOARD_DEV_AUTH_USER_ID || DEFAULT_DEV_AUTH_USER_ID;
}

export function devDiscordUserId() {
  return (
    process.env.EWC_DASHBOARD_DEV_DISCORD_USER_ID ||
    DEFAULT_DEV_DISCORD_USER_ID
  );
}

export function isDevAuthUser(authUserId: string) {
  return isDevAuthBypassEnabled() && authUserId === devAuthUserId();
}

export function devSession(): Session {
  const now = new Date();
  return {
    user: {
      id: devAuthUserId(),
      name: process.env.EWC_DASHBOARD_DEV_NAME || "Local Discord Preview",
      email: `${devDiscordUserId()}@discord.local`,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: "dev-local-session",
      token: "dev-local-session",
      userId: devAuthUserId(),
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    },
  } as Session;
}
