import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getTournamentById, updateTournamentOverrides } from "@bot/db/tournaments.js";
import { isKnownGameSlug, normalizeGameSlug } from "@bot/lib/games.js";
import { getAdminAccess, isSuper } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import { sameOriginOr403 } from "@/lib/community";
import { readBoundedJson, requestBodyErrorResponse } from "@/lib/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BODY_LIMIT = 8 * 1024;

function configuredGuildId() {
  const guildId = String(process.env.DISCORD_GUILD_ID || "").trim();
  return /^\d{1,32}$/.test(guildId) ? guildId : null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuper(access)) return NextResponse.json({ error: "Super admin only" }, { status: 403 });

  const guildId = configuredGuildId();
  if (!guildId) {
    return NextResponse.json({ error: "Tournament operations are not configured." }, { status: 503 });
  }
  const tournamentId = Number((await params).id);
  if (!Number.isSafeInteger(tournamentId) || tournamentId <= 0) {
    return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  }
  const tournament = await getTournamentById(tournamentId);
  if (!tournament || String(tournament.guild_id) !== guildId) {
    return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  }

  const parsedBody = await readBoundedJson<Record<string, unknown>>(request, BODY_LIMIT);
  if (!parsedBody.ok) return requestBodyErrorResponse(parsedBody.reason);
  const body = parsedBody.value;
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !["displayName", "game", "ewc"].includes(key)) ||
    !["displayName", "game", "ewc"].every((key) => Object.hasOwn(body, key))
  ) {
    return NextResponse.json(
      { error: "Display name, game, and EWC overrides are required." },
      { status: 400 },
    );
  }

  let displayName: string | null = null;
  if (body.displayName != null && body.displayName !== "") {
    if (
      typeof body.displayName !== "string" ||
      body.displayName.length > 180 ||
      /[\u0000-\u001f\u007f]/.test(body.displayName)
    ) {
      return NextResponse.json({ error: "The display name override is not valid." }, { status: 400 });
    }
    displayName = body.displayName.trim() || null;
  }

  let game: string | null = null;
  if (body.game != null && body.game !== "") {
    if (typeof body.game !== "string") {
      return NextResponse.json({ error: "The game override is not valid." }, { status: 400 });
    }
    game = normalizeGameSlug(body.game.trim());
    if (!game || !isKnownGameSlug(game)) {
      return NextResponse.json({ error: "The game override is not supported." }, { status: 400 });
    }
  }
  if (body.ewc !== null && typeof body.ewc !== "boolean") {
    return NextResponse.json(
      { error: "The EWC override must be true, false, or inherited." },
      { status: 400 },
    );
  }

  const updated = await updateTournamentOverrides(tournamentId, guildId, {
    displayName,
    game,
    ewc: body.ewc as boolean | null,
  });
  if (!updated) return NextResponse.json({ error: "Tournament not found." }, { status: 404 });

  recordAdminAudit(access, "tournament.metadata.update", String(tournamentId), {
    displayName,
    game,
    ewc: body.ewc,
  });
  revalidatePath("/admin/tournaments");
  revalidatePath(`/tournaments/${tournamentId}`);
  return NextResponse.json({ tournament: updated });
}
