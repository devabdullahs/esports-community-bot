import { NextResponse } from "next/server";
import { isAllowedLogoUrl, loadLogoBytes, rasterLogoContentType } from "@bot/lib/logoSource.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const contentType = rasterLogoContentType(logo.bytes);
  if (!contentType) {
    return new NextResponse(null, {
      status: 404,
      headers: { "Cache-Control": "public, max-age=30" },
    });
  }

  return new NextResponse(new Uint8Array(logo.bytes), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
