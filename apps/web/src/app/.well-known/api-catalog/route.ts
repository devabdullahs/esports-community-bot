import { absoluteUrl } from "@/lib/metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// RFC 9727 API catalog (application/linkset+json, RFC 9264): advertises the
// public, unauthenticated read APIs so agents can discover them. We have no
// OpenAPI spec, so each entry links to the human-facing page (service-doc)
// rather than a machine spec (service-desc).
export function GET() {
  const linkset = [
    {
      anchor: absoluteUrl("/api/tournaments"),
      "service-doc": [{ href: absoluteUrl("/tournaments"), title: "Tracked tournaments" }],
    },
    {
      anchor: absoluteUrl("/api/tournaments/{id}/matches"),
      "service-doc": [{ href: absoluteUrl("/tournaments"), title: "Tournament matches" }],
    },
    {
      anchor: absoluteUrl("/api/ewc/{guildId}/{season}/leaderboard"),
      "service-doc": [{ href: absoluteUrl("/leaderboard"), title: "Prediction leaderboard" }],
    },
    {
      anchor: absoluteUrl("/api/public-mcp"),
      "service-doc": [{ href: absoluteUrl("/docs/mcp"), title: "Public MCP server" }],
    },
  ];

  return new Response(JSON.stringify({ linkset }, null, 2), {
    headers: {
      "Content-Type": "application/linkset+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
