import "server-only";
import { createHash } from "node:crypto";

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

export function getDeploymentVersion() {
  if (cachedVersion) return cachedVersion;
  // Opaque, public build token: a hash of the resolved deploy id. It still changes
  // on every deployment (so the update-alert detects a new build) but does NOT
  // reveal the exact commit SHA on a public repo. No HOSTNAME fallback — an unset
  // version yields "development" rather than leaking the container id publicly.
  const raw = envDeploymentVersion();
  cachedVersion = raw ? createHash("sha256").update(raw).digest("hex").slice(0, 12) : "development";
  return cachedVersion;
}
