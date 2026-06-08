import "server-only";

import { isDevAuthUser } from "@/lib/dev-auth";
import { getDiscordAccountForAuthUser } from "@/lib/ewc-profile-sync";
import { getOptionalSession } from "@/lib/session";

function adminDiscordIds() {
  return new Set(
    String(process.env.EWC_DASHBOARD_ADMIN_DISCORD_IDS || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

export async function getAdminAccess() {
  const session = await getOptionalSession();
  if (!session) return { session: null, discordUserId: null, allowed: false };
  const account = getDiscordAccountForAuthUser(session.user.id);
  const admins = adminDiscordIds();
  if (isDevAuthUser(session.user.id)) {
    return {
      session,
      discordUserId: account?.accountId || null,
      allowed: true,
    };
  }
  return {
    session,
    discordUserId: account?.accountId || null,
    allowed: Boolean(account?.accountId && admins.has(account.accountId)),
  };
}
