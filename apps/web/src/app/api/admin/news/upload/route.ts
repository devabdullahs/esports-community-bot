import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getAdminAccess } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import { sameOriginOr403 } from "@/lib/community";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { isR2Configured, uploadToR2 } from "@/lib/r2";
import { matchesMagicBytes } from "@/lib/image-upload";

export { matchesMagicBytes } from "@/lib/image-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SVG is intentionally excluded — it can carry scripts. Raster/modern formats only.
const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

export async function POST(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const access = await getAdminAccess();
  const { session, allowed } = access;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const countLimited = await rateLimitOr429({
    key: `upload-count:${access.discordUserId}`,
    limit: 30,
    windowSec: 3600,
  });
  if (countLimited) return countLimited;

  if (!isR2Configured()) {
    return NextResponse.json(
      {
        error:
          "Image upload is not configured yet. Set the R2_* environment variables, or paste an image URL instead.",
      },
      { status: 503 },
    );
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: "Unsupported image type. Use PNG, JPEG, WebP, GIF, or AVIF." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image exceeds the 8 MB limit." }, { status: 400 });
  }

  const bytesLimited = await rateLimitOr429({
    key: `upload-bytes:${access.discordUserId}`,
    limit: 209715200, // 200 MB per day
    windowSec: 86400,
    amount: file.size,
  });
  if (bytesLimited) return bytesLimited;

  const bytes = new Uint8Array(await file.arrayBuffer());

  if (!matchesMagicBytes(bytes, file.type)) {
    return NextResponse.json(
      { error: "File content does not match its image type." },
      { status: 400 },
    );
  }

  const day = new Date().toISOString().slice(0, 10);
  const key = `news/${day}/${randomUUID()}.${ext}`;

  try {
    const url = await uploadToR2({ key, body: bytes, contentType: file.type });
    recordAdminAudit(access, "news.upload", null, { key });
    return NextResponse.json({ url });
  } catch (error) {
    const errorId = randomUUID().slice(0, 8);
    console.error(`[upload:${errorId}]`, error);
    return NextResponse.json(
      { error: `Upload failed — try again or paste an image URL instead. (ref ${errorId})` },
      { status: 502 },
    );
  }
}
