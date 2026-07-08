import { NextResponse } from "next/server";
import { getAdminAccess, isSuper } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import { sameOriginOr403 } from "@/lib/community";
import { getMcpKey, revokeMcpKey } from "@/lib/mcp-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuper(access)) return NextResponse.json({ error: "Super admin only" }, { status: 403 });

  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "Invalid key id" }, { status: 400 });
  const existing = await getMcpKey(id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await revokeMcpKey(id);
  await recordAdminAudit(access, "mcp_key.revoke", String(id), {
    ownerDiscordId: existing.ownerDiscordId,
    keyPrefix: existing.keyPrefix,
  });
  return NextResponse.json({ ok: true });
}
