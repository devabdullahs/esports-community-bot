import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const ENV_VERSION_KEYS = [
  "ECB_DEPLOYMENT_VERSION",
  "CRANL_DEPLOYMENT_ID",
  "SOURCE_COMMIT",
  "SOURCE_VERSION",
  "GITHUB_SHA",
  "VERCEL_GIT_COMMIT_SHA",
  "CF_PAGES_COMMIT_SHA",
];

const originalCwd = process.cwd();
const originalEnv = new Map(ENV_VERSION_KEYS.map((key) => [key, process.env[key]]));

let tempDir: string;

async function loadDeploymentVersion() {
  vi.resetModules();
  return import("@/lib/deployment-version");
}

function restoreEnv() {
  for (const key of ENV_VERSION_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("getDeploymentVersion", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ecb-deployment-version-"));
    process.chdir(tempDir);
    for (const key of ENV_VERSION_KEYS) delete process.env[key];
  });

  afterEach(() => {
    process.chdir(originalCwd);
    restoreEnv();
    vi.resetModules();
    rmSync(tempDir, { force: true, recursive: true });
  });

  test("hashes explicit deployment env values", async () => {
    process.env.ECB_DEPLOYMENT_VERSION = "cranl-deploy-123";
    const { getDeploymentVersion } = await loadDeploymentVersion();

    expect(getDeploymentVersion()).toMatch(/^[a-f0-9]{12}$/);
    expect(getDeploymentVersion()).not.toContain("cranl-deploy-123");
  });

  test("falls back to the Next build id when deployment env values are absent", async () => {
    const buildIdPath = join(tempDir, "apps", "web", ".next", "BUILD_ID");
    mkdirSync(join(tempDir, "apps", "web", ".next"), { recursive: true });
    writeFileSync(buildIdPath, "next-build-a\n");

    const firstModule = await loadDeploymentVersion();
    const first = firstModule.getDeploymentVersion();

    writeFileSync(buildIdPath, "next-build-b\n");
    const secondModule = await loadDeploymentVersion();
    const second = secondModule.getDeploymentVersion();

    expect(first).toMatch(/^[a-f0-9]{12}$/);
    expect(second).toMatch(/^[a-f0-9]{12}$/);
    expect(second).not.toBe(first);
  });

  test("uses development only when no deploy or build version is available", async () => {
    const { getDeploymentVersion } = await loadDeploymentVersion();

    expect(getDeploymentVersion()).toBe("development");
  });
});
