import { NextResponse } from "next/server";
import { unlinkEwcProfileForAuthUser } from "@/lib/ewc-profile-sync";
import { getOptionalSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getOptionalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await unlinkEwcProfileForAuthUser(session.user.id));
}
