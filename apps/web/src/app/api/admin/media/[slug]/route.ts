import { NextResponse } from "next/server";
import { canManageMedia, getAdminAccess, isSuper } from "@/lib/admin";
import { deleteMediaChannel, updateMediaChannel } from "@/lib/media";
import { validateMediaContent } from "@/lib/media-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!access.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { slug } = await context.params;
  if (!canManageMedia(access, slug)) {
    return NextResponse.json({ error: "You are not assigned to this channel" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const validated = validateMediaContent(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  const updated = updateMediaChannel(slug, validated.value);
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuper(access)) return NextResponse.json({ error: "Super admin only" }, { status: 403 });

  const { slug } = await context.params;
  const result = deleteMediaChannel(slug);
  if (result.deleted === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
