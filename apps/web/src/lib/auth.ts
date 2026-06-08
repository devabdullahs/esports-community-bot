import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { db } from "@bot/db/connection.js";
import { dashboardPublicUrl, trustedOrigins } from "@/lib/env";

function discordImage(profile: { id: string; avatar?: string | null; image_url?: string }) {
  if (profile.image_url) return profile.image_url;
  if (!profile.avatar) return undefined;
  const ext = profile.avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.${ext}?size=128`;
}

export const auth = betterAuth({
  appName: "EWC Predictions",
  baseURL: dashboardPublicUrl(),
  secret:
    process.env.BETTER_AUTH_SECRET ||
    "development-build-secret-change-before-production",
  database: db,
  trustedOrigins: trustedOrigins(),
  socialProviders: {
    discord: {
      clientId: process.env.DISCORD_CLIENT_ID || "missing-discord-client-id",
      clientSecret:
        process.env.DISCORD_CLIENT_SECRET || "missing-discord-client-secret",
      scope: ["identify", "email", "role_connections.write"],
      mapProfileToUser(profile) {
        return {
          name: profile.global_name || profile.display_name || profile.username,
          email: profile.email || `${profile.id}@discord.local`,
          emailVerified: Boolean(profile.verified || profile.email),
          image: discordImage(profile),
        };
      },
    },
  },
  account: {
    updateAccountOnSignIn: true,
    encryptOAuthTokens: true,
    accountLinking: {
      enabled: true,
      trustedProviders: ["discord"],
    },
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
  },
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
