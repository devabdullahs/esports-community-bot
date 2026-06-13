import "server-only";

import { getAdmin } from "@/lib/admins";
import type { Session } from "@/lib/auth";
import { getDiscordAccountForAuthUser } from "@/lib/auth-database";
import { isDevAuthUser } from "@/lib/dev-auth";
import { getOptionalSession } from "@/lib/session";

export type AdminAccess = {
  session: Session | null;
  discordUserId: string | null;
  displayName: string | null;
  isSuper: boolean;
  /** Assigned game slugs, or "ALL" for super admins. */
  games: string[] | "ALL";
  /** Assigned media-channel slugs, or "ALL" for super admins. */
  media: string[] | "ALL";
  /** True for super admins, or regular admins with at least one assignment. */
  allowed: boolean;
};

function parseIds(value: string | undefined): Set<string> {
  return new Set(
    String(value || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

// Super admins are env-defined (bootstrap, cannot be removed in-app). The legacy flat
// admin list is folded into super for back-compat so existing deployments keep full access.
function superAdminDiscordIds(): Set<string> {
  return parseIds(process.env.EWC_DASHBOARD_SUPER_ADMIN_DISCORD_IDS);
}
function legacyAdminDiscordIds(): Set<string> {
  return parseIds(process.env.EWC_DASHBOARD_ADMIN_DISCORD_IDS);
}

const NO_ACCESS: AdminAccess = {
  session: null,
  discordUserId: null,
  displayName: null,
  isSuper: false,
  games: [],
  media: [],
  allowed: false,
};

export async function getAdminAccess(): Promise<AdminAccess> {
  const session = await getOptionalSession();
  if (!session) return NO_ACCESS;

  const account = await getDiscordAccountForAuthUser(session.user.id);
  const discordUserId = account?.accountId ?? null;
  const displayName = session.user.name ?? null;

  const isSuperAdmin =
    isDevAuthUser(session.user.id) ||
    Boolean(
      discordUserId &&
        (superAdminDiscordIds().has(discordUserId) ||
          legacyAdminDiscordIds().has(discordUserId)),
    );

  if (isSuperAdmin) {
    return {
      session,
      discordUserId,
      displayName,
      isSuper: true,
      games: "ALL",
      media: "ALL",
      allowed: true,
    };
  }

  if (discordUserId) {
    const admin = await getAdmin(discordUserId);
    if (admin) {
      return {
        session,
        discordUserId,
        displayName,
        isSuper: false,
        games: admin.games,
        media: admin.media,
        allowed: admin.games.length > 0 || admin.media.length > 0,
      };
    }
  }

  return { ...NO_ACCESS, session, discordUserId, displayName };
}

export function isSuper(access: AdminAccess): boolean {
  return access.isSuper;
}

export function canManageGame(access: AdminAccess, slug: string): boolean {
  return access.isSuper || (access.games !== "ALL" && access.games.includes(slug));
}

export function canManageMedia(access: AdminAccess, slug: string): boolean {
  return access.isSuper || (access.media !== "ALL" && access.media.includes(slug));
}
