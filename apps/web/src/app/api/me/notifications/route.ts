import { NextResponse } from "next/server";
import { sameOriginOr403 } from "@/lib/community";
import {
  countUnread,
  getViewerDiscordId,
  listNotificationPage,
  markAllRead,
  markRead,
} from "@/lib/follows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function parsePageInteger(value: string | null, fallback: number, { min, max }: { min: number; max?: number }) {
  if (value === null) return fallback;
  if (value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || (max !== undefined && parsed > max)) return null;
  return parsed;
}

export async function GET(request: Request) {
  const discordUserId = await getViewerDiscordId();
  if (!discordUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const limit = parsePageInteger(url.searchParams.get("limit"), DEFAULT_PAGE_SIZE, {
    min: 1,
    max: MAX_PAGE_SIZE,
  });
  const offset = parsePageInteger(url.searchParams.get("offset"), 0, { min: 0 });
  if (limit === null || offset === null) {
    return NextResponse.json({ error: "Invalid notification page." }, { status: 400 });
  }

  const [page, unread] = await Promise.all([
    listNotificationPage(discordUserId, { limit, offset }),
    countUnread(discordUserId),
  ]);
  return NextResponse.json({ ...page, unread });
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
