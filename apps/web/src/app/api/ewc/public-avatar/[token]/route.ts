import { NextResponse } from "next/server";
import { getPublicEwcProfileAvatarByToken } from "@bot/db/ewcProfileLinks.js";
import { approvedDiscordAvatarUrl } from "@/lib/public-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) return new NextResponse(null, { status: 404 });
  const source = approvedDiscordAvatarUrl(await getPublicEwcProfileAvatarByToken(token));
  if (!source) return new NextResponse(null, { status: 404 });
  try {
    const upstream = await fetch(source, { redirect: "error", cache: "no-store", headers: { Accept: "image/*" } });
    const type = upstream.headers.get("content-type") || "";
    if (!upstream.ok || !type.startsWith("image/")) return new NextResponse(null, { status: 404 });
    return new NextResponse(upstream.body, { headers: { "Content-Type": type, "Cache-Control": "private, no-store" } });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
