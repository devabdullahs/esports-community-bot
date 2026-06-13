import "server-only";

import { Pool } from "pg";
import { devDiscordUserId, isDevAuthUser } from "@/lib/dev-auth";

type SqliteDatabase = typeof import("@bot/db/connection.js").db;

type DiscordAccount = {
  accountId: string;
  userId: string;
};

const pgPoolKey = "__esportsCommunityBotPgPool";
const driver = (process.env.DB_DRIVER || "").toLowerCase();
const usePostgres = driver === "postgres" || (!driver && Boolean(process.env.DATABASE_URL));

function postgresSslConfig() {
  const mode = String(process.env.PGSSLMODE || "").toLowerCase();
  if (mode === "disable") return false;
  if (mode === "require" || mode === "no-verify") return { rejectUnauthorized: false };
  return undefined;
}

function getPostgresPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required when DB_DRIVER=postgres.");
  }

  const globalWithPool = globalThis as typeof globalThis & { __esportsCommunityBotPgPool?: Pool };
  if (!globalWithPool[pgPoolKey]) {
    globalWithPool[pgPoolKey] = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: postgresSslConfig(),
    });
  }
  return globalWithPool[pgPoolKey];
}

async function getSqliteDatabase(): Promise<SqliteDatabase> {
  const mod = await import("@bot/db/connection.js");
  return mod.db;
}

export const authDatabase = usePostgres ? getPostgresPool() : await getSqliteDatabase();

export function isPostgresAuthDatabase() {
  return usePostgres;
}

export async function getDiscordAccountForAuthUser(authUserId: string): Promise<DiscordAccount | null> {
  if (isDevAuthUser(authUserId)) {
    return {
      accountId: devDiscordUserId(),
      userId: authUserId,
    };
  }

  if (usePostgres) {
    const result = await getPostgresPool().query<DiscordAccount>(
      `SELECT "accountId", "userId"
       FROM "account"
       WHERE "userId" = $1 AND "providerId" = 'discord'
       ORDER BY "updatedAt" DESC
       LIMIT 1`,
      [authUserId],
    );
    return result.rows[0] || null;
  }

  try {
    return (
      (authDatabase as SqliteDatabase)
        .prepare(
          `SELECT accountId, userId
           FROM account
           WHERE userId = ? AND providerId = 'discord'
           ORDER BY updatedAt DESC
           LIMIT 1`,
        )
        .get(authUserId) as DiscordAccount | undefined
    ) || null;
  } catch (error) {
    if (/no such table: account/i.test(String((error as Error).message))) return null;
    throw error;
  }
}
