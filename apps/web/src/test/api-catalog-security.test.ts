import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { GET } from "@/app/.well-known/api-catalog/route";

const ORIGINAL_PUBLIC_URL = process.env.EWC_DASHBOARD_PUBLIC_URL;
const PUBLIC_ORIGIN = "https://esportscommunity.net";
const PUBLIC_API_PATHS = [
  "/api/ewc/%7BguildId%7D/%7Bseason%7D/leaderboard",
  "/api/public-mcp",
  "/api/tournaments",
  "/api/tournaments/%7Bid%7D/matches",
  "/feed.xml",
];
const PRIVATE_MARKERS = [
  "/api/admin",
  "/api/internal",
  "/api/mcp",
  "/api/me",
  "x-ewc-internal-secret",
  "ewc_dashboard_internal",
  "127.0.0.1",
  "esports-bot:3000",
];

afterEach(() => {
  if (ORIGINAL_PUBLIC_URL === undefined) {
    delete process.env.EWC_DASHBOARD_PUBLIC_URL;
  } else {
    process.env.EWC_DASHBOARD_PUBLIC_URL = ORIGINAL_PUBLIC_URL;
  }
});

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(fullPath) : [fullPath];
  }));
  return nested.flat();
}

describe("public API description inventory", () => {
  test("the API catalog exposes only the explicit public allowlist", async () => {
    process.env.EWC_DASHBOARD_PUBLIC_URL = PUBLIC_ORIGIN;
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/linkset+json");

    const raw = await response.text();
    const payload = JSON.parse(raw) as {
      linkset: Array<{ anchor: string }>;
    };
    const paths = payload.linkset
      .map((entry) => new URL(entry.anchor).pathname)
      .sort();

    expect(paths).toEqual(PUBLIC_API_PATHS);
    expect(raw.toLowerCase()).not.toContain("localhost");
    for (const marker of PRIVATE_MARKERS) {
      expect(raw.toLowerCase()).not.toContain(marker);
    }
  });

  test("no unclassified OpenAPI or Swagger artifact is publicly served", async () => {
    const roots = [
      path.resolve(process.cwd(), "src", "app"),
      path.resolve(process.cwd(), "public"),
    ];
    const files = (await Promise.all(roots.map(filesBelow))).flat();
    const suspiciousNames = files.filter((file) => (
      /(?:openapi|swagger|api[-_.]?docs?)/i.test(path.basename(file))
    ));

    expect(suspiciousNames).toEqual([]);

    const publicDescriptionFiles = [
      path.resolve(process.cwd(), "src", "app", ".well-known", "api-catalog", "route.ts"),
      path.resolve(process.cwd(), "src", "app", "docs", "mcp", "page.tsx"),
      path.resolve(process.cwd(), "src", "app", "docs", "admin-mcp", "page.tsx"),
    ];
    const content = (
      await Promise.all(publicDescriptionFiles.map((file) => readFile(file, "utf8")))
    ).join("\n").toLowerCase();

    for (const marker of PRIVATE_MARKERS) {
      expect(content).not.toContain(marker);
    }
  });
});
