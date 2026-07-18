import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { getAdminAccess } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import { sameOriginOr403 } from "@/lib/community";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { isR2Configured, uploadToR2 } from "@/lib/r2";
import { matchesMagicBytes } from "@/lib/image-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const canUpload = access.isSuper || access.media === "ALL" || access.media.length > 0;
  if (!access.allowed || !access.discordUserId || !canUpload) {
    return NextResponse.json({ error: "Custom branding is limited to assigned media channels" }, { status: 403 });
  }

  const limited = await rateLimitOr429({
    key: `admin:graphics-brand-upload:${access.discordUserId}`,
    limit: 20,
    windowSec: 3600,
  });
  if (limited) return limited;
  if (!isR2Configured()) {
    return NextResponse.json({ error: "Image upload is not configured" }, { status: 503 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  const extension = ALLOWED_TYPES[file.type];
  if (!extension) {
    return NextResponse.json({ error: "Use a PNG, JPEG, or WebP logo" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Logo exceeds the 4 MB limit" }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!matchesMagicBytes(bytes, file.type)) {
    return NextResponse.json({ error: "File content does not match its image type" }, { status: 400 });
  }

  const key = `graphics-branding/${randomUUID()}.${extension}`;
  try {
    const url = await uploadToR2({ key, body: bytes, contentType: file.type });
    recordAdminAudit(access, "graphics.brand-upload", null, { key });
    return NextResponse.json({ url });
  } catch (error) {
    const errorId = randomUUID().slice(0, 8);
    console.error(`[graphics-brand-upload:${errorId}]`, error);
    return NextResponse.json({ error: `Upload failed (ref ${errorId})` }, { status: 502 });
  }
}
