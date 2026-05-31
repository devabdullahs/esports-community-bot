import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Dynamically import every *.js file in a directory.
// pathToFileURL is required on Windows: ESM import() needs a file:// URL, not a raw path.
export async function loadModules(dir) {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  const modules = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(join(dir, file)).href);
    modules.push({ file, mod });
  }
  return modules;
}
