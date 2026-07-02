import { NextResponse } from "next/server";
import { sameOriginOr403 } from "@/lib/community";
import {
  countUnread,
  getViewerDiscordId,
  listNotifications,
  markAllRead,
  markRead,
} from "@/lib/follows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const discordUserId = await getViewerDiscordId();
  if (!discordUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit")) || 30;
  const offset = Number(url.searchParams.get("offset")) || 0;
  const [notifications, unread] = await Promise.all([
    listNotifications(discordUserId, { limit, offset }),
    countUnread(discordUserId),
  ]);
  return NextResponse.json({ notifications, unread });
}

export async function PATCH(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;
  const discordUserId = await getViewerDiscordId();
  if (!discordUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  if (body.all === true) {
    const marked = await markAllRead(discordUserId);
    return NextResponse.json({ marked });
  }
  const id = Number(body.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid notification id." }, { status: 400 });
  }
  const marked = await markRead(discordUserId, id);
  return NextResponse.json({ marked });
}
