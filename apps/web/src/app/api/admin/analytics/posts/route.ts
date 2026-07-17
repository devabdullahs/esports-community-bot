import { NextResponse } from "next/server";
import { canManageGame, canManageMedia, getAdminAccess } from "@/lib/admin";
import { getPostAnalytics } from "@/lib/web-analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_JSON = { "Cache-Control": "private, no-store" };

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_JSON });
}

function scopeParam(value: string | null): string | null | undefined {
  if (value === null) return null;
  const slug = value.trim();
  if (!slug || slug.length > 80) return undefined;
  return slug;
}

export async function GET(request: Request) {
  const access = await getAdminAccess();
  if (!access.session) return privateJson({ error: "Unauthorized" }, 401);
  if (!access.allowed) return privateJson({ error: "Forbidden" }, 403);

  const url = new URL(request.url);
  const mediaSlug = scopeParam(url.searchParams.get("media"));
  const gameSlug = scopeParam(url.searchParams.get("game"));
  if (mediaSlug === undefined || gameSlug === undefined || (mediaSlug && gameSlug)) {
    return privateJson({ error: "Choose one valid analytics scope" }, 400);
  }

  if (mediaSlug && !canManageMedia(access, mediaSlug)) {
    return privateJson({ error: "You are not assigned to this channel" }, 403);
  }
  if (gameSlug && !canManageGame(access, gameSlug)) {
    return privateJson({ error: "You are not assigned to this game" }, 403);
  }
  if (!mediaSlug && !gameSlug && !access.isSuper) {
    return privateJson({ error: "Choose an assigned analytics scope" }, 403);
  }

  const daysValue = url.searchParams.get("days");
  const daysParam = daysValue === null ? Number.NaN : Number(daysValue);
  const analytics = await getPostAnalytics({
    mediaSlug,
    gameSlug,
    ...(Number.isFinite(daysParam) ? { days: daysParam } : {}),
  });
  return privateJson({ analytics });
}
