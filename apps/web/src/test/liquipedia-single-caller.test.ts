import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// Liquipedia's limits apply to us globally, not per process, and the penalty for
// crossing them is a ban rather than a throttle. The pacing that keeps us inside
// them — one serialized queue, a >=30s parse floor, a >=2.5s search floor,
// backoff persisted across restarts — is enforced per process.
//
// The bot and the dashboard are already SEPARATE processes in the same
// container, so a second caller in the web means a second clock. This asserts
// there is exactly one caller: the bot.
//
// Parsers are fine. They turn already-fetched HTML into data and touch no
// network, which is why the allowance below is by module rather than blanket.

const WEB_SOURCE_ROOT = join(process.cwd(), "src");

// Modules under @bot/services/liquipedia that perform no request.
const REQUEST_FREE_MODULES = ["@bot/services/liquipedia/entityParsers.js"];

const LIQUIPEDIA_IMPORT = /["'`](@bot\/services\/liquipedia[^"'`]*)["'`]/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      // The test directory legitimately mocks the service by module id.
      return entry === "test" ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

describe("Liquipedia has exactly one caller", () => {
  test("no dashboard module imports a Liquipedia module that makes requests", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(WEB_SOURCE_ROOT)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(LIQUIPEDIA_IMPORT)) {
        const moduleId = match[1];
        if (REQUEST_FREE_MODULES.includes(moduleId)) continue;
        offenders.push(`${file.replace(process.cwd(), "").replace(/\\/g, "/")} -> ${moduleId}`);
      }
    }

    expect(
      offenders,
      "The dashboard must not fetch from Liquipedia. The bot owns the wire: it is the only " +
        "process whose request pacing is authoritative, and a second caller means a second " +
        "clock against a limit whose penalty is a ban. Read the snapshot the bot stores, or " +
        "add the module to REQUEST_FREE_MODULES if it genuinely performs no request.",
    ).toEqual([]);
  });

  test("the guard actually looks at real files", () => {
    const files = sourceFiles(WEB_SOURCE_ROOT);
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((file) => file.endsWith("ewc-clubs.ts"))).toBe(true);
  });
});
