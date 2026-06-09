import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "@aws-sdk/client-s3"],
};

export default nextConfig;
