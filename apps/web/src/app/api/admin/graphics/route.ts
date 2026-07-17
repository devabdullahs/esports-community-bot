import { NextResponse } from "next/server";
import { getAdminAccess } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import { sameOriginOr403 } from "@/lib/community";
import {
  canManageGraphicsOwner,
  renderGraphics,
  resolveGraphicsRenderRequest,
} from "@/lib/graphics-generator";
import { parseGraphicsRenderRequest } from "@/lib/graphics-generator-model";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { readBoundedJson } from "@/lib/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_CONTROL = "private, no-store";
const RATE_LIMIT = { limit: 20, windowSec: 600 };
const MAX_BODY_BYTES = 4 * 1024;

function privateJson(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": CACHE_CONTROL } });
}

function privateResponse(response: NextResponse) {
  response.headers.set("Cache-Control", CACHE_CONTROL);
  return response;
}

export async function POST(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return privateResponse(origin);

  const access = await getAdminAccess();
  if (!access.session) return privateJson({ error: "Unauthorized" }, 401);
  if (!access.allowed || !access.discordUserId) return privateJson({ error: "Forbidden" }, 403);

  const limited = await rateLimitOr429({
    key: `admin:graphics:${access.discordUserId}`,
    ...RATE_LIMIT,
  });
  if (limited) return privateResponse(limited);

  const body = await readBoundedJson(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return privateJson(
      { error: body.reason === "too_large" ? "Graphics request is too large" : "Invalid graphics request" },
      body.reason === "too_large" ? 413 : 400,
    );
  }
  const parsed = parseGraphicsRenderRequest(body.value);
  if (!parsed) return privateJson({ error: "Invalid graphics request" }, 400);

  const resolved = await resolveGraphicsRenderRequest(parsed);
  if (!resolved) return privateJson({ error: "Graphics source not found" }, 404);
  if (!canManageGraphicsOwner(access, resolved.owner)) {
    return privateJson({ error: "You are not assigned to this source" }, 403);
  }

  try {
    const image = await renderGraphics(resolved);
    recordAdminAudit(access, "graphics.render", `${parsed.template}:${resolved.target.id}`, {
      template: parsed.template,
      ownerType: resolved.owner.kind,
      ownerSlug: resolved.owner.slug,
    });
    return new NextResponse(new Uint8Array(image), {
      headers: {
        "Cache-Control": CACHE_CONTROL,
        "Content-Disposition": `attachment; filename="graphics-${parsed.template}-${resolved.target.id}.png"`,
        "Content-Type": "image/png",
      },
    });
  } catch (error) {
    console.error("[graphics] Failed to render admin graphic.", error);
    return privateJson({ error: "Unable to render the graphic right now" }, 500);
  }
}
