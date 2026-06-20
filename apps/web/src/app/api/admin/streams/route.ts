import { NextResponse } from "next/server";
import { getAdminAccess, isSuper } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import { sameOriginOr403 } from "@/lib/community";
import { createStreamChannel, listStreamChannels, STREAM_SCOPES, type StreamScope } from "@/lib/stream-channels";
import { validateStreamChannelInput } from "@/lib/stream-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!access.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const rawScope = url.searchParams.get("scope");
  const scope = rawScope && (STREAM_SCOPES as readonly string[]).includes(rawScope) ? (rawScope as StreamScope) : null;
  const game = url.searchParams.get("game");
  const channels = await listStreamChannels({ scope, gameSlug: game || null });
  return NextResponse.json({ channels });
}

export async function POST(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuper(access)) return NextResponse.json({ error: "Super admin only" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const validated = validateStreamChannelInput(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  let channel;
  try {
    channel = await createStreamChannel({ ...validated.value, addedBy: access.discordUserId ?? null });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
  recordAdminAudit(access, "stream.create", channel.handle, { platform: channel.platform, scope: channel.scope });
  return NextResponse.json(channel);
}
