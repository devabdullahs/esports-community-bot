import { NextResponse } from "next/server";
import { canManageMedia, getAdminAccess } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import { sameOriginOr403 } from "@/lib/community";
import {
  canManageGraphicsOwner,
  renderGraphics,
  resolveCustomGraphicsRenderRequest,
  resolveGraphicsRenderRequest,
} from "@/lib/graphics-generator";
import { parseGraphicsRenderRequest } from "@/lib/graphics-generator-model";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { readBoundedJson } from "@/lib/request-body";
import { isManagedR2Url } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_CONTROL = "private, no-store";
// The workspace auto-renders the preview (debounced) as controls change, so
// the budget covers an active editing session, not just explicit exports.
const RATE_LIMIT = { limit: 60, windowSec: 600 };
const MAX_BODY_BYTES = 32 * 1024;

function privateJson(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": CACHE_CONTROL } });
}

function privateResponse(response: NextResponse) {
  response.headers.set("Cache-Control", CACHE_CONTROL);
  return response;
}

function customAssetUrls(parsed: ReturnType<typeof parseGraphicsRenderRequest>): string[] {
  if (!parsed || parsed.sourceMode !== "custom") return [];
  if (parsed.template === "match-result") {
    return [parsed.data.logoA, parsed.data.logoB].filter((value): value is string => Boolean(value));
  }
  if (parsed.template === "standings") {
    return parsed.data.entries.map((entry) => entry.logo).filter((value): value is string => Boolean(value));
  }
  return [];
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
  if (parsed.brandMediaSlug && !canManageMedia(access, parsed.brandMediaSlug)) {
    return privateJson({ error: "You are not assigned to this media channel" }, 403);
  }
  if (parsed.brandAssetUrl) {
    const canUseCustomBrand = access.isSuper || access.media === "ALL" || access.media.length > 0;
    if (!canUseCustomBrand) {
      return privateJson({ error: "Custom branding is limited to assigned media channels" }, 403);
    }
    if (!isManagedR2Url(parsed.brandAssetUrl, "graphics-branding/")) {
      return privateJson({ error: "Invalid custom branding asset" }, 400);
    }
  }

  if (customAssetUrls(parsed).some((url) => !isManagedR2Url(url, "graphics-assets/"))) {
    return privateJson({ error: "Invalid custom graphics asset" }, 400);
  }

  const resolved = parsed.sourceMode === "custom"
    ? await resolveCustomGraphicsRenderRequest(parsed)
    : await resolveGraphicsRenderRequest(parsed);
  if (!resolved) return privateJson({ error: "Graphics source not found" }, 404);
  if (resolved.owner && !canManageGraphicsOwner(access, resolved.owner)) {
    return privateJson({ error: "You are not assigned to this source" }, 403);
  }

  try {
    const image = await renderGraphics(resolved);
    const auditTarget = resolved.target.id === null ? `${parsed.template}:custom` : `${parsed.template}:${resolved.target.id}`;
    recordAdminAudit(access, "graphics.render", auditTarget, {
      template: parsed.template,
      sourceMode: parsed.sourceMode,
      ownerType: resolved.owner?.kind ?? "custom",
      ownerSlug: resolved.owner?.slug ?? null,
      brandMediaSlug: parsed.brandMediaSlug,
      customBrand: Boolean(parsed.brandAssetUrl),
    });
    return new NextResponse(new Uint8Array(image), {
      headers: {
        "Cache-Control": CACHE_CONTROL,
        "Content-Disposition": `attachment; filename="graphics-${parsed.template}-${resolved.target.id ?? "custom"}.png"`,
        "Content-Type": "image/png",
      },
    });
  } catch (error) {
    console.error("[graphics] Failed to render admin graphic.", error);
    return privateJson({ error: "Unable to render the graphic right now" }, 500);
  }
}
