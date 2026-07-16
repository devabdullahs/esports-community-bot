import { NextResponse } from "next/server";
import { clientIp } from "@/lib/community";
import { getRequestLocale } from "@/lib/request-locale";
import { rateLimitOr429 } from "@/lib/rate-limit";
import {
  parseShareCardVariant,
  renderShareCardForViewer,
  ShareCardProfileRequiredError,
} from "@/lib/share-card";
import { getOptionalSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_CONTROL = "private, no-store";

function privateJson(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": CACHE_CONTROL } });
}

function privateRateLimit(response: NextResponse) {
  response.headers.set("Cache-Control", CACHE_CONTROL);
  return response;
}

export async function GET(request: Request) {
  const session = await getOptionalSession();
  if (!session) return privateJson({ error: "Unauthorized" }, 401);

  const url = new URL(request.url);
  const variants = url.searchParams.getAll("variant");
  const variant = variants.length === 1 ? parseShareCardVariant(variants[0]) : null;
  if (!variant) return privateJson({ error: "Invalid share card variant." }, 400);

  const userLimited = await rateLimitOr429({
    key: `share-card:user:${session.user.id}`,
    limit: 10,
    windowSec: 60,
  });
  if (userLimited) return privateRateLimit(userLimited);

  const ipLimited = await rateLimitOr429({
    key: `share-card:ip:${clientIp(request)}`,
    limit: 30,
    windowSec: 60,
  });
  if (ipLimited) return privateRateLimit(ipLimited);

  try {
    const image = await renderShareCardForViewer({
      authUserId: session.user.id,
      displayName: session.user.name,
      avatarUrl: session.user.image,
      variant,
      locale: await getRequestLocale(),
    });
    return new NextResponse(new Uint8Array(image), {
      headers: {
        "Cache-Control": CACHE_CONTROL,
        "Content-Disposition": 'attachment; filename="ewc-prediction-card.png"',
        "Content-Type": "image/png",
      },
    });
  } catch (error) {
    if (error instanceof ShareCardProfileRequiredError) {
      return privateJson({ error: "A prediction profile is required to create a share card." }, 409);
    }
    console.error("[share-card] Failed to render private share card.", error);
    return privateJson({ error: "Unable to create the share card right now." }, 500);
  }
}
