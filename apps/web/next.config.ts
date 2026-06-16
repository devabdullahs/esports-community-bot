import type { NextConfig } from "next";

const r2Host = (() => {
  try {
    return process.env.R2_PUBLIC_BASE_URL ? new URL(process.env.R2_PUBLIC_BASE_URL).origin : null;
  } catch {
    return null;
  }
})();

const csp = [
  "default-src 'self'",
  // Next.js App Router requires inline scripts/styles without a nonce pipeline.
  "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  // Covers are admin-pasted https URLs (safe-url enforces scheme), so https: is deliberate.
  `img-src 'self' data: blob: https:`,
  `font-src 'self' https://assets.moonbot.info${r2Host ? ` ${r2Host}` : ""}`,
  "connect-src 'self' https://cloudflareinsights.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const isProd = process.env.NODE_ENV === "production";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // RFC 8288 discovery: point agents at the API catalog (RFC 9727).
  { key: "Link", value: '</.well-known/api-catalog>; rel="api-catalog"' },
  ...(isProd ? [{ key: "Content-Security-Policy", value: csp }] : []),
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "pg", "@aws-sdk/client-s3"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
