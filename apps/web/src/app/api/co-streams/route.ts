import { getAllPublicCoStreamsCached } from "@/lib/public-co-streams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const streams = await getAllPublicCoStreamsCached();
  return Response.json({ streams });
}
