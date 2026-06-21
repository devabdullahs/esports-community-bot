import { NextResponse } from "next/server";
import { getAdminAccess, isSuper } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import { sameOriginOr403 } from "@/lib/community";
import { deleteStreamChannel, updateStreamChannel, type UpdateStreamChannelInput } from "@/lib/stream-channels";
import { normalizeCreatorKey } from "@/lib/stream-normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuper(access)) return NextResponse.json({ error: "Super admin only" }, { status: 403 });

  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: UpdateStreamChannelInput = {};
  if (typeof body.label === "string") patch.label = body.label.trim().slice(0, 120);
  if (typeof body.language === "string") patch.language = body.language.trim().toLowerCase().slice(0, 8);
  if (typeof body.active === "boolean") patch.active = body.active;
  if (typeof body.creatorKey === "string") {
    patch.creatorKey = normalizeCreatorKey(body.creatorKey);
  }
  if (Array.isArray(body.gameSlugs)) patch.gameSlugs = body.gameSlugs.map((v) => String(v));
  if (typeof body.isDefault === "boolean") patch.isDefault = body.isDefault;
  if (typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)) patch.sortOrder = body.sortOrder;

  const updated = await updateStreamChannel(id, patch);
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  recordAdminAudit(access, "stream.update", String(id), { active: updated.active });
  return NextResponse.json(updated);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuper(access)) return NextResponse.json({ error: "Super admin only" }, { status: 403 });

  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const result = await deleteStreamChannel(id);
  if (!result.deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  recordAdminAudit(access, "stream.delete", String(id));
  return NextResponse.json({ ok: true });
}
