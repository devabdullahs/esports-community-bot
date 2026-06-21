import {
  STREAM_PLATFORMS,
  STREAM_SCOPES,
  type CreateStreamChannelInput,
  type StreamPlatform,
  type StreamScope,
} from "@/lib/stream-types";
import { normalizeCreatorKey, normalizeGameSlugs } from "@/lib/stream-normalize";

const PLATFORM_SET = new Set<string>(STREAM_PLATFORMS);
const SCOPE_SET = new Set<string>(STREAM_SCOPES);

export const STREAM_LABEL_MAX = 120;
export const STREAM_HANDLE_MAX = 200;
export const STREAM_TEAM_MAX = 120;
export const STREAM_MATCH_ID_MAX = 200;
export const STREAM_CREATOR_KEY_MAX = 80;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Validate + normalize the admin create payload. Handle normalization (URL/@handle
// → canonical) happens in the bot registry module; here we just enforce shape and
// the per-scope required keys.
export function validateStreamChannelInput(
  raw: unknown,
): { ok: true; value: CreateStreamChannelInput } | { ok: false; error: string } {
  const body = (raw ?? {}) as Record<string, unknown>;

  const platform = str(body.platform);
  if (!PLATFORM_SET.has(platform)) {
    return { ok: false, error: "Pick a platform (twitch, kick, youtube, or soop)." };
  }
  const scope = str(body.scope);
  if (!SCOPE_SET.has(scope)) {
    return { ok: false, error: "Pick a scope (game, team, match, or ewc)." };
  }

  const handle = str(body.handle);
  if (!handle) return { ok: false, error: "A channel handle or URL is required." };
  if (handle.length > STREAM_HANDLE_MAX) return { ok: false, error: "Handle is too long." };

  const label = str(body.label);
  if (label.length > STREAM_LABEL_MAX) {
    return { ok: false, error: `Label must be ${STREAM_LABEL_MAX} characters or fewer.` };
  }

  const language = str(body.language).toLowerCase();
  if (language.length > 8) return { ok: false, error: "Language code is too long." };

  const gameSlugs = normalizeGameSlugs(body.gameSlugs ?? body.gameSlug);
  const gameSlug = gameSlugs[0] ?? "";
  const creatorKey = normalizeCreatorKey(body.creatorKey);
  const team = str(body.team);
  const matchExternalId = str(body.matchExternalId);

  if (scope === "game" && !gameSlug) return { ok: false, error: "A game-scope channel needs a game." };
  if (scope === "team" && !team) return { ok: false, error: "A team-scope channel needs a team name." };
  if (scope === "match" && !matchExternalId) {
    return { ok: false, error: "A match-scope channel needs a match external id." };
  }
  if (team.length > STREAM_TEAM_MAX) return { ok: false, error: "Team name is too long." };
  if (matchExternalId.length > STREAM_MATCH_ID_MAX) return { ok: false, error: "Match id is too long." };

  return {
    ok: true,
    value: {
      platform: platform as StreamPlatform,
      handle,
      label: label || undefined,
      scope: scope as StreamScope,
      gameSlug: gameSlug || undefined,
      gameSlugs,
      creatorKey: creatorKey || undefined,
      team: team || undefined,
      matchExternalId: matchExternalId || undefined,
      language: language || undefined,
      isDefault: Boolean(body.isDefault),
    },
  };
}
