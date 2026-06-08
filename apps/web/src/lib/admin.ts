import "server-only";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getDiscordAccountForAuthUser } from "@/lib/ewc-profile-sync";

function adminDiscordIds() {
  return new Set(
    String(process.env.EWC_DASHBOARD_ADMIN_DISCORD_IDS || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

export async function getAdminAccess() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { session: null, discordUserId: null, allowed: false };
  const account = getDiscordAccountForAuthUser(session.user.id);
  const admins = adminDiscordIds();
  return {
    session,
    discordUserId: account?.accountId || null,
    allowed: Boolean(account?.accountId && admins.has(account.accountId)),
  };
}
