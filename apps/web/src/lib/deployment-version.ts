import "server-only";

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ENV_VERSION_KEYS = [
  "ECB_DEPLOYMENT_VERSION",
  "CRANL_DEPLOYMENT_ID",
  "SOURCE_COMMIT",
  "SOURCE_VERSION",
  "GITHUB_SHA",
  "VERCEL_GIT_COMMIT_SHA",
  "CF_PAGES_COMMIT_SHA",
];

let cachedVersion: string | null = null;

function normalizeVersion(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 120) : "";
}

function envDeploymentVersion() {
  for (const key of ENV_VERSION_KEYS) {
    const value = normalizeVersion(process.env[key]);
    if (value) return value;
  }
  return "";
}

function candidateBuildRoots() {
  const roots = new Set<string>();
  let current = process.cwd();

  for (let depth = 0; depth < 8; depth += 1) {
    roots.add(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return roots;
}

function readBuildIdFrom(path: string) {
  try {
    if (!existsSync(path)) return "";
    return normalizeVersion(readFileSync(path, "utf8"));
  } catch {
    return "";
  }
}

function nextBuildVersion() {
  for (const root of candidateBuildRoots()) {
    const direct = readBuildIdFrom(join(root, ".next", "BUILD_ID"));
    if (direct) return `next:${direct}`;

    const workspace = readBuildIdFrom(join(root, "apps", "web", ".next", "BUILD_ID"));
    if (workspace) return `next:${workspace}`;
  }

  return "";
}

export function getDeploymentVersion() {
  if (cachedVersion) return cachedVersion;
  // Opaque, public build token: a hash of the resolved deploy id. It changes on
  // every deployment, but does not reveal the exact commit SHA or Next BUILD_ID.
  // No HOSTNAME fallback: container hostnames are not deployment versions.
  const raw = envDeploymentVersion() || nextBuildVersion();
  cachedVersion = raw ? createHash("sha256").update(raw).digest("hex").slice(0, 12) : "development";
  return cachedVersion;
}
