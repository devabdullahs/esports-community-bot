const DEFAULT_FONT_BASE_URL = "https://assets.moonbot.info";
const ALLOWED_FONT_ROOTS = new Set([
  "thmanyahsans",
  "thmanyahserifdisplay",
  "thmanyahseriftext",
]);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAllowedFontPath(parts: string[]) {
  if (parts.length !== 3) return false;
  if (!ALLOWED_FONT_ROOTS.has(parts[0])) return false;
  if (parts[1] !== "woff2") return false;
  if (!/^thmanyah(?:sans|serifdisplay|seriftext)-(?:Light|Regular|Medium|Bold|Black)\.woff2$/.test(parts[2])) {
    return false;
  }
  return parts.every((part) => part && !part.includes("..") && !part.includes("\\"));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fontPath: string[] }> },
) {
  const { fontPath } = await params;
  if (!isAllowedFontPath(fontPath)) {
    return new Response("Not found", { status: 404 });
  }

  const baseUrl = process.env.THMANYAH_FONT_BASE_URL || DEFAULT_FONT_BASE_URL;
  const upstreamUrl = new URL(fontPath.join("/"), baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const upstream = await fetch(upstreamUrl, {
    headers: { Accept: "font/woff2" },
    next: { revalidate: 60 * 60 * 24 * 30 },
  });

  if (!upstream.ok) {
    return new Response("Font unavailable", { status: upstream.status });
  }

  return new Response(await upstream.arrayBuffer(), {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": "font/woff2",
    },
  });
}
