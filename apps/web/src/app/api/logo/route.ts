import { NextResponse } from "next/server";
import { isAllowedLogoUrl, loadLogoBytes } from "@bot/lib/logoSource.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function contentTypeOf(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a") {
    return "image/gif";
  }
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (bytes.subarray(0, 256).toString("utf8").trimStart().startsWith("<svg")) return "image/svg+xml";
  return "application/octet-stream";
}

export async function GET(request: Request) {
  const source = new URL(request.url).searchParams.get("url")?.trim();
  if (!source || !isAllowedLogoUrl(source)) {
    return NextResponse.json({ error: "Invalid logo URL." }, { status: 400 });
  }

  // Serve cached Liquipedia logos, but do not let public page views create
  // fresh upstream downloads by default. The bot warms this cache while making
  // match cards; set WEB_LOGO_PROXY_DOWNLOADS=true only for a controlled warmup.
  const logo = await loadLogoBytes(source, "web", {
    download: process.env.WEB_LOGO_PROXY_DOWNLOADS === "true",
  });
  if (!logo) {
    // Keep misses cacheable only briefly. In production this usually means
    // the bot has not warmed this logo into the shared cache yet.
    return new NextResponse(null, {
      status: 404,
      headers: { "Cache-Control": "public, max-age=30" },
    });
  }

  return new NextResponse(new Uint8Array(logo.bytes), {
    headers: {
      "Content-Type": contentTypeOf(logo.bytes),
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
