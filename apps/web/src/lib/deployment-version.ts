import "server-only";

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
  cachedVersion =
    envDeploymentVersion() ||
    normalizeVersion(process.env.HOSTNAME) ||
    "development";
  return cachedVersion;
}
