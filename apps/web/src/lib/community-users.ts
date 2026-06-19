import "server-only";

import { activityForDiscordIds, listCommentsByAuthor } from "@bot/db/communityUsers.js";
import { getBlock, listBlockedUsers } from "@bot/db/communityUserBlocks.js";
import { getEwcProfileLinkByDiscordUser } from "@bot/db/ewcProfileLinks.js";
import { authDatabase, isPostgresAuthDatabase } from "@/lib/auth-database";
import { clampInt } from "@/lib/validate";

// Dashboard-registered users, enriched with bot-side activity. The auth tables
// ("user", "account") live in the better-auth DB and the activity/blocks live
// in the bot DB — we query each side separately and join in JS (never raw-join
// across the two backends).

// Shapes returned by the untyped bot JS modules (annotated here at the boundary).
type Activity = { commentCount: number; lastCommentAt: string | null; likeCount: number };
type BlockRow = {
  discordUserId: string;
  blockedBy: string;
  blockedByName: string | null;
  reason: string | null;
  createdAt: string;
};
type AuthorComment = { id: number; postId: number; body: string; status: string; createdAt: string };

export type CommunityUserRow = {
  authUserId: string;
  name: string | null;
  image: string | null;
  createdAt: string;
  discordUserId: string | null;
  commentCount: number;
  likeCount: number;
  lastActivityAt: string | null;
  ewcLinked: boolean;
  blocked: boolean;
};

export type CommunityUserDetail = {
  authUserId: string;
  name: string | null;
  image: string | null;
  createdAt: string;
  discordUserId: string;
  commentCount: number;
  likeCount: number;
  lastActivityAt: string | null;
  ewcLinked: boolean;
  block: {
    discordUserId: string;
    blockedBy: string;
    blockedByName: string | null;
    reason: string | null;
    createdAt: string;
  } | null;
  comments: Array<{
    id: number;
    postId: number;
    body: string;
    status: string;
    createdAt: string;
  }>;
};

type AuthUserRow = {
  id: string;
  name: string | null;
  image: string | null;
  createdAt: string;
  discordUserId: string | null;
};

type PgAuthDatabase = {
  query: (sql: string, params: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};
type SqliteAuthDatabase = {
  prepare: (sql: string) => { all: (...params: unknown[]) => Array<Record<string, unknown>>; get: (...params: unknown[]) => Record<string, unknown> | undefined };
};

function normalizeRow(row: Record<string, unknown>): AuthUserRow {
  return {
    id: String(row.id),
    name: (row.name as string | null) ?? null,
    image: (row.image as string | null) ?? null,
    createdAt: String(row.createdAt),
    discordUserId: (row.discordUserId as string | null) ?? null,
  };
}

export async function listCommunityUsers({
  search,
  limit,
  offset,
}: {
  search?: string | null;
  limit?: unknown;
  offset?: unknown;
}): Promise<{ users: CommunityUserRow[]; total: number }> {
  const take = clampInt(limit, { min: 1, max: 100, fallback: 50 });
  const skip = clampInt(offset, { min: 0, max: Number.MAX_SAFE_INTEGER, fallback: 0 });
  const term = (search ?? "").trim();
  const hasSearch = term.length > 0;

  let rows: AuthUserRow[];
  let total: number;

  try {
    if (isPostgresAuthDatabase()) {
      const pg = authDatabase as PgAuthDatabase;
      const where = hasSearch
        ? `WHERE u.name ILIKE $1 OR a."accountId" = $2`
        : "";
      const searchParams = hasSearch ? [`%${term}%`, term] : [];
      const listSql =
        `SELECT u.id, u.name, u.image, u."createdAt", a."accountId" AS "discordUserId"
         FROM "user" u
         LEFT JOIN "account" a ON a."userId" = u.id AND a."providerId" = 'discord'
         ${where}
         ORDER BY u."createdAt" DESC
         LIMIT $${searchParams.length + 1} OFFSET $${searchParams.length + 2}`;
      const listResult = await pg.query(listSql, [...searchParams, take, skip]);
      rows = listResult.rows.map(normalizeRow);

      const countSql =
        `SELECT COUNT(*) AS total
         FROM "user" u
         LEFT JOIN "account" a ON a."userId" = u.id AND a."providerId" = 'discord'
         ${where}`;
      const countResult = await pg.query(countSql, searchParams);
      total = Number(countResult.rows[0]?.total ?? 0);
    } else {
      const sqlite = authDatabase as SqliteAuthDatabase;
      const where = hasSearch
        ? `WHERE u.name LIKE ? OR a.accountId = ?`
        : "";
      const searchParams = hasSearch ? [`%${term}%`, term] : [];
      const listSql =
        `SELECT u.id, u.name, u.image, u.createdAt, a.accountId AS discordUserId
         FROM "user" u
         LEFT JOIN account a ON a.userId = u.id AND a.providerId = 'discord'
         ${where}
         ORDER BY u.createdAt DESC
         LIMIT ? OFFSET ?`;
      rows = sqlite.prepare(listSql).all(...searchParams, take, skip).map(normalizeRow);

      const countSql =
        `SELECT COUNT(*) AS total
         FROM "user" u
         LEFT JOIN account a ON a.userId = u.id AND a.providerId = 'discord'
         ${where}`;
      const countRow = sqlite.prepare(countSql).get(...searchParams);
      total = Number(countRow?.total ?? 0);
    }
  } catch (error) {
    // Before the better-auth tables exist (fresh install), treat as empty.
    if (/no such table|does not exist/i.test(String((error as Error).message))) {
      return { users: [], total: 0 };
    }
    throw error;
  }

  const discordIds = rows
    .map((r) => r.discordUserId)
    .filter((id): id is string => Boolean(id));

  const activity = (await activityForDiscordIds(discordIds)) as Map<string, Activity>;
  const blockedList = (await listBlockedUsers()) as Array<{ discordUserId: string }>;
  const blocked = new Set(blockedList.map((b) => b.discordUserId));
  const linked = new Set(
    (
      await Promise.all(
        discordIds.map(async (id) => ((await getEwcProfileLinkByDiscordUser(id)) ? id : null)),
      )
    ).filter((id): id is string => Boolean(id)),
  );

  const users: CommunityUserRow[] = rows.map((r) => {
    const a = r.discordUserId ? activity.get(r.discordUserId) : undefined;
    return {
      authUserId: r.id,
      name: r.name,
      image: r.image,
      createdAt: r.createdAt,
      discordUserId: r.discordUserId,
      commentCount: a?.commentCount ?? 0,
      likeCount: a?.likeCount ?? 0,
      lastActivityAt: a?.lastCommentAt ?? null,
      ewcLinked: r.discordUserId ? linked.has(r.discordUserId) : false,
      blocked: r.discordUserId ? blocked.has(r.discordUserId) : false,
    };
  });

  return { users, total };
}

export async function getCommunityUserDetail(discordUserId: string): Promise<CommunityUserDetail | null> {
  let row: AuthUserRow | null;

  try {
    if (isPostgresAuthDatabase()) {
      const pg = authDatabase as PgAuthDatabase;
      const result = await pg.query(
        `SELECT u.id, u.name, u.image, u."createdAt", a."accountId" AS "discordUserId"
         FROM "account" a
         JOIN "user" u ON u.id = a."userId"
         WHERE a."accountId" = $1 AND a."providerId" = 'discord'
         ORDER BY a."updatedAt" DESC
         LIMIT 1`,
        [discordUserId],
      );
      row = result.rows[0] ? normalizeRow(result.rows[0]) : null;
    } else {
      const sqlite = authDatabase as SqliteAuthDatabase;
      const found = sqlite
        .prepare(
          `SELECT u.id, u.name, u.image, u.createdAt, a.accountId AS discordUserId
           FROM account a
           JOIN "user" u ON u.id = a.userId
           WHERE a.accountId = ? AND a.providerId = 'discord'
           ORDER BY a.updatedAt DESC
           LIMIT 1`,
        )
        .get(discordUserId);
      row = found ? normalizeRow(found) : null;
    }
  } catch (error) {
    if (/no such table|does not exist/i.test(String((error as Error).message))) return null;
    throw error;
  }

  if (!row) return null;

  const activity = (await activityForDiscordIds([discordUserId])) as Map<string, Activity>;
  const a = activity.get(discordUserId);
  const ewcLinked = Boolean(await getEwcProfileLinkByDiscordUser(discordUserId));
  const block = (await getBlock(discordUserId)) as BlockRow | null;
  const comments = (await listCommentsByAuthor(discordUserId, 50)) as AuthorComment[];

  return {
    authUserId: row.id,
    name: row.name,
    image: row.image,
    createdAt: row.createdAt,
    discordUserId,
    commentCount: a?.commentCount ?? 0,
    likeCount: a?.likeCount ?? 0,
    lastActivityAt: a?.lastCommentAt ?? null,
    ewcLinked,
    block,
    comments,
  };
}
