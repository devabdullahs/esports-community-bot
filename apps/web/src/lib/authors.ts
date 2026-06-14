import "server-only";

import { get } from "@bot/db/client.js";
import { listEwcAdmins } from "@bot/db/ewcAdmins.js";

export type EligibleAuthor = {
  discordId: string;
  name: string;
  avatarUrl: string | null;
};

type AdminRoster = {
  discordId: string;
  displayName: string;
  games: string[];
};

const listAdmins = listEwcAdmins as () => Promise<AdminRoster[]>;

function parseIds(value: string | undefined): string[] {
  return String(value || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

// Super admins are env-defined (super list + legacy flat list, both treated as
// super per lib/admin.ts). They can author for ANY game.
function superAdminDiscordIds(): string[] {
  return [
    ...parseIds(process.env.EWC_DASHBOARD_SUPER_ADMIN_DISCORD_IDS),
    ...parseIds(process.env.EWC_DASHBOARD_ADMIN_DISCORD_IDS),
  ];
}

// Env supers have no roster row, so their display name lives only in the
// better-auth user table (if they've ever signed in). Mirror the defensive
// no-such-table handling used by safeAccountQuery in ewc-profile-sync.ts.
async function lookupAuthInfo(
  discordId: string,
): Promise<{ name: string | null; avatarUrl: string | null }> {
  try {
    const row = (await get(
      `SELECT u.name AS name, u.image AS image
       FROM "account" a
       JOIN "user" u ON u.id = a."userId"
       WHERE a."accountId" = $1 AND a."providerId" = 'discord'
       ORDER BY a."updatedAt" DESC
       LIMIT 1`,
      [discordId],
    )) as { name?: string | null; image?: string | null } | null;
    return {
      name: typeof row?.name === "string" && row.name.trim() ? row.name : null,
      avatarUrl: typeof row?.image === "string" && row.image.trim() ? row.image : null,
    };
  } catch (error) {
    if (/no such table|does not exist/i.test(String((error as Error).message)))
      return { name: null, avatarUrl: null };
    throw error;
  }
}

/**
 * Discord users eligible to be credited as the author of a post for `gameSlug`:
 *  - every super admin (env-defined), and
 *  - roster admins whose assigned games include this game slug.
 *
 * Names prefer the roster displayName; env supers fall back to their signed-in
 * user name, then to the raw discordId. Deduped by discordId, supers first then
 * alphabetical by name.
 */
export async function listEligibleAuthors(gameSlug: string): Promise<EligibleAuthor[]> {
  const supers = superAdminDiscordIds();
  const superSet = new Set(supers);
  const roster = await listAdmins();
  const rosterById = new Map(roster.map((a) => [a.discordId, a]));

  const byId = new Map<string, { author: EligibleAuthor; isSuper: boolean }>();

  const infoFor = async (
    discordId: string,
  ): Promise<{ name: string; avatarUrl: string | null }> => {
    const rosterRow = rosterById.get(discordId);
    const auth = await lookupAuthInfo(discordId);
    const name =
      rosterRow?.displayName && rosterRow.displayName.trim()
        ? rosterRow.displayName
        : auth.name || discordId;
    return { name, avatarUrl: auth.avatarUrl };
  };

  // Supers first — eligible for any game.
  for (const discordId of supers) {
    if (byId.has(discordId)) continue;
    byId.set(discordId, { author: { discordId, ...(await infoFor(discordId)) }, isSuper: true });
  }

  // Roster admins scoped to this game.
  for (const admin of roster) {
    if (byId.has(admin.discordId)) continue;
    if (!admin.games.includes(gameSlug)) continue;
    byId.set(admin.discordId, {
      author: { discordId: admin.discordId, ...(await infoFor(admin.discordId)) },
      isSuper: superSet.has(admin.discordId),
    });
  }

  return [...byId.values()]
    .sort((a, b) => {
      if (a.isSuper !== b.isSuper) return a.isSuper ? -1 : 1;
      return a.author.name.localeCompare(b.author.name);
    })
    .map((entry) => entry.author);
}
