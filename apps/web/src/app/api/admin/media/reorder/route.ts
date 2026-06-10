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
  if (
    !Array.isArray(body.slugs) ||
    body.slugs.length === 0 ||
    !body.slugs.every((s: unknown) => typeof s === "string")
  ) {
    return NextResponse.json(
      { error: "slugs must be a non-empty array of strings" },
      { status: 400 },
    );
  }
  const slugs: string[] = body.slugs;

  try {
    return NextResponse.json({ channels: reorderMediaChannels(slugs) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
