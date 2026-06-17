import { NextResponse } from "next/server";
import { unlinkEwcProfileForAuthUser } from "@/lib/ewc-profile-sync";
import { sameOriginOr403 } from "@/lib/community";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { getOptionalSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const session = await getOptionalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = await rateLimitOr429({ key: `ewc-unlink:${session.user.id}`, limit: 2, windowSec: 600 });
  if (limited) return limited;

  return NextResponse.json(await unlinkEwcProfileForAuthUser(session.user.id));
}
