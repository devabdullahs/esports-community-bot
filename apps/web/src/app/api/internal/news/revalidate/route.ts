import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { isInternalRequestAuthorized } from "@/lib/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isInternalRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  revalidateTag("cms-news", { expire: 0 });
  return NextResponse.json({ ok: true });
}
