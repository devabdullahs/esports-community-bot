import "server-only";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// R2 is S3-compatible. Server-side upload (browser -> our API -> R2) so credentials
// never reach the client and the bucket's GET-only CORS policy is enough (the public
// <img> read is a GET). Configure via env; until then uploads return a clear error and
// admins can still paste image URLs.
//
// We use the AWS S3 SDK (not fetch/aws4fetch) because R2 rejects chunked-transfer PUTs
// with 411 MissingContentLength, and `Content-Length` is a forbidden header in fetch —
// the SDK sets it correctly via its own HTTP handler.
const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const BUCKET = process.env.R2_BUCKET || "";

// Accept the public base URL with or without a scheme (e.g. "assets.moonbot.info"
// or "https://assets.moonbot.info") and always normalize to an absolute https URL.
function normalizeBaseUrl(raw: string | undefined): string {
  const value = (raw || "").trim().replace(/\/+$/, "");
  if (!value) return "";
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}
const PUBLIC_BASE_URL = normalizeBaseUrl(process.env.R2_PUBLIC_BASE_URL);

export function isR2Configured(): boolean {
  return Boolean(ACCOUNT_ID && ACCESS_KEY_ID && SECRET_ACCESS_KEY && BUCKET && PUBLIC_BASE_URL);
}

let client: S3Client | null = null;
function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
    });
  }
  return client;
}

export async function uploadToR2({
  key,
  body,
  contentType,
}: {
  key: string;
  body: Uint8Array | ArrayBuffer;
  contentType: string;
}): Promise<string> {
  if (!isR2Configured()) throw new Error("R2 storage is not configured.");

  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
  await s3().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: bytes,
      ContentType: contentType,
      ContentLength: bytes.byteLength,
    }),
  );

  return `${PUBLIC_BASE_URL}/${key}`;
}
