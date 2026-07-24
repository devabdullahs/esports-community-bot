import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  postgresMigrationsRequested,
  resolvePgSslConfig,
  runPostgresMigrations,
  sanitizePostgresError,
} from '../src/db/postgresMigrations.js';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

try {
  process.loadEnvFile?.(resolve(rootDir, '.env'));
} catch {
  // Production passes configuration through the process environment.
}

export async function runMigrationCli(env = process.env) {
  if (!postgresMigrationsRequested(env)) {
    console.log('[migrations] skipped (PostgreSQL is not configured).');
    return { skipped: true };
  }

  try {
    const result = await runPostgresMigrations({
      connectionString: env.DATABASE_URL,
      ssl: resolvePgSslConfig(env.PGSSLMODE, { rootCertPath: env.PGSSLROOTCERT }),
      onStatus: ({ version }) => console.log('[migrations] applied ' + version),
    });
    if (!result.applied.length) {
      console.log('[migrations] up to date.');
    }
    return result;
  } catch (error) {
    console.error('[migrations] failed: ' + sanitizePostgresError(error, env.DATABASE_URL));
    throw error;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  try {
    await runMigrationCli();
  } catch {
    process.exitCode = 1;
  }
}
