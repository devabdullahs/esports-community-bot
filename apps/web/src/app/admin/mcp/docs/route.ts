export const runtime = "nodejs";

export function GET() {
  return new Response(null, {
    status: 308,
    headers: {
      Location: "/docs/admin-mcp",
    },
  });
}
