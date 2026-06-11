import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getAdminAccess } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import { isR2Configured, uploadToR2 } from "@/lib/r2";

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

function matchesMagicBytes(bytes: Uint8Array, mimeType: string): boolean {
  if (bytes.length < 12) return false;
  switch (mimeType) {
    case "image/png":
      // 89 50 4E 47
      return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    case "image/jpeg":
      // FF D8 FF
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/gif":
      // 47 49 46 38
      return bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38;
    case "image/webp":
      // RIFF at 0 + WEBP at offset 8
      return (
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
    case "image/avif":
      // ftyp at offset 4
      return bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
    default:
      return false;
  }
}

export async function POST(request: Request) {
  const access = await getAdminAccess();
  const { session, allowed } = access;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
