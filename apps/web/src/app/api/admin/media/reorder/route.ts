import { NextResponse } from "next/server";
import { getAdminAccess, isSuper } from "@/lib/admin";
import { reorderMediaChannels } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuper(access)) return NextResponse.json({ error: "Super admin only" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const slugs = Array.isArray(body.slugs) ? body.slugs.filter((s: unknown) => typeof s === "string") : null;
  if (!slugs || slugs.length === 0) {
    return NextResponse.json({ error: "slugs array is required" }, { status: 400 });
  }

  return NextResponse.json({ channels: reorderMediaChannels(slugs) });
}
