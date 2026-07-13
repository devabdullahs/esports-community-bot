import { absoluteUrl } from "@/lib/metadata";

export const runtime = "nodejs";
// Generated per request so the Sitemap URL uses the runtime public host (env vars
// are unset during the Docker build). Served as a route handler (not the metadata
// robots.ts) so we can emit the AIPREF Content-Signal directive, which the
// MetadataRoute.Robots schema does not support.
export const dynamic = "force-dynamic";

export function GET() {
  const body = [
    "User-agent: *",
    // AIPREF content signals (contentsignals.org): allow search indexing and AI
    // answers/citations, but opt out of using this content to train AI models.
    "Content-Signal: search=yes, ai-train=no, ai-input=yes",
    "Allow: /",
    // Admin surface, API routes, and per-user/auth pages are not for crawlers.
    "Disallow: /admin",
    "Disallow: /api/",
    // `$` prevents the private `/me` route from prefix-matching public
    // `/media` pages in Google robots syntax.
    "Disallow: /me$",
    "Disallow: /me?",
    "Disallow: /ar/me$",
    "Disallow: /ar/me?",
    "",
    `Sitemap: ${absoluteUrl("/sitemap.xml")}`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // Browsers revalidate; shared CDNs may cache briefly. A short edge TTL
      // keeps crawler directives responsive across deployments and two CDN layers.
      "Cache-Control": "public, max-age=0, s-maxage=300, must-revalidate",
    },
  });
}
