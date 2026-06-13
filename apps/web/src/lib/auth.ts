import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { authDatabase } from "@/lib/auth-database";
import { dashboardPublicUrl, trustedOrigins } from "@/lib/env";

// Fail closed in production: never serve requests with a known/default auth secret,
// or session cookies could be forged. The fallback is only for local dev and the
// production *build* step (which serves no requests).
function resolveAuthSecret() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (secret) return secret;
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  if (process.env.NODE_ENV === "production" && !isBuild) {
    throw new Error(
      "BETTER_AUTH_SECRET must be set in production — refusing to start with a default secret.",
    );
  }
  return "development-insecure-secret-change-before-production";
}

function discordImage(profile: { id: string; avatar?: string | null; image_url?: string }) {
  if (profile.image_url) return profile.image_url;
  if (!profile.avatar) return undefined;
  const ext = profile.avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.${ext}?size=128`;
}

export const auth = betterAuth({
  appName: "EWC Predictions",
  baseURL: dashboardPublicUrl(),
  secret: resolveAuthSecret(),
  database: authDatabase,
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
