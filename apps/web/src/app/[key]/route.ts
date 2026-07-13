import { NextResponse } from "next/server";
import { indexNowKey } from "@/lib/indexnow";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ key: string }> },
) {
  const configured = indexNowKey();
  const { key } = await context.params;
  if (!configured || key !== `${configured}.txt`) {
    return new NextResponse("Not found", { status: 404 });
  }
  return new NextResponse(configured, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}
