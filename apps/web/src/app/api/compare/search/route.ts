import { NextResponse, type NextRequest } from "next/server";
import {
  parseComparisonKind,
  parseComparisonSearchQuery,
  searchComparisonProfiles,
} from "@/lib/profile-comparison";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const kind = parseComparisonKind(request.nextUrl.searchParams.get("kind"));
  const query = parseComparisonSearchQuery(request.nextUrl.searchParams.get("q"));
  if (!kind || query === null) {
    return NextResponse.json({ error: "Invalid comparison search." }, { status: 400 });
  }

  const profiles = await searchComparisonProfiles(kind, query);
  return NextResponse.json(
    { profiles },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
