import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildPostgresSchemaSnapshot } from '../src/db/postgresMigrations.js';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = resolve(rootDir, 'scripts/postgres/schema.sql');

export async function buildPostgresSchema({ check = false } = {}) {
  const generated = buildPostgresSchemaSnapshot();
  if (check) {
    const committed = (await readFile(schemaPath, 'utf8')).replace(/\r\n?/g, '\n');
    if (committed !== generated) {
      throw new Error('scripts/postgres/schema.sql is out of date. Run npm run db:pg:schema:generate.');
    }
    return { changed: false };
  }

  await writeFile(schemaPath, generated, 'utf8');
  return { changed: true };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  const check = process.argv.slice(2).includes('--check');
  try {
    await buildPostgresSchema({ check });
    console.log(check ? '[schema] generated PostgreSQL snapshot is current.' : '[schema] generated PostgreSQL snapshot.');
  } catch (error) {
    console.error('[schema] ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}
