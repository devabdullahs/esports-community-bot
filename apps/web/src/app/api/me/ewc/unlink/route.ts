import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { unlinkEwcProfileForAuthUser } from "@/lib/ewc-profile-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await unlinkEwcProfileForAuthUser(session.user.id));
}
