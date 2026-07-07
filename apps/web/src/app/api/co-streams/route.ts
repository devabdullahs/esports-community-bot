import { getAllCoStreamsCached } from "@/lib/co-streams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const streams = await getAllCoStreamsCached();
  return Response.json({ streams });
}
