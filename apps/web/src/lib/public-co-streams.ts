import "server-only";

import { createHmac } from "node:crypto";
import { unstable_cache } from "next/cache";
import { getAllCoStreams, getEwcCoStreams } from "@/lib/co-streams";
import type { CoStream, CoStreamChannel } from "@/lib/stream-types";
import type { PublicCoStream, PublicCoStreamChannel } from "@/lib/public-co-stream-types";

export type { PublicCoStream, PublicCoStreamChannel };

// The only place internal co-stream records become public data.
//
// Anonymous responses previously carried whole database rows, disclosing an administrator's
// Discord ID along with row IDs, audit timestamps, active/sort flags, and team/match linkage.
// Every field below is written out by hand: a spread would re-admit each of those and would
// silently publish whatever `StreamChannel` gains next.

const PUBLIC_ID_PREFIX = "cs1_";
const ID_KEY_LABEL = "public-co-stream-id/v1";

let derivedIdKey: { root: string; key: Buffer } | null = null;

/**
 * The digest must be keyed, not plain. The internal key is built from a public scope, a public
 * creator handle, and a team/match pair enumerable from public tournament data, so a plain
 * SHA-256 leaves a candidate space small enough to hash offline: an anonymous visitor could
 * confirm which team and match a group belongs to, recovering exactly the linkage the DTO omits.
 * An HMAC makes that impossible without the server key.
 *
 * Derived from the root secret through a labelled HMAC rather than used directly, so this
 * subkey cannot stand in for the root anywhere else, and the token cannot be run backwards to
 * recover it. Resolved lazily and re-derived when the root changes, so no process-lifetime
 * cache pins a stale key.
 */
function publicIdKey(): Buffer {
  const root = resolveIdSecret();
  if (derivedIdKey?.root === root) return derivedIdKey.key;
  derivedIdKey = { root, key: createHmac("sha256", root).update(ID_KEY_LABEL).digest() };
  return derivedIdKey.key;
}

/**
 * Same fail-closed policy as `resolveAuthSecret` in lib/auth.ts, for the same reason: a served
 * production request must never key public tokens with a value an attacker can read off GitHub,
 * because a known key is no better than no key at all. The production *build* serves no
 * requests and has no secret in the image, so it keeps the fallback.
 */
function resolveIdSecret(): string {
  const configured = (process.env.EWC_PUBLIC_ID_SECRET || process.env.BETTER_AUTH_SECRET || "").trim();
  if (configured) return configured;
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  if (process.env.NODE_ENV === "production" && !isBuild) {
    throw new Error(
      "EWC_PUBLIC_ID_SECRET or BETTER_AUTH_SECRET must be set in production — refusing to publish co-stream IDs under a default key.",
    );
  }
  return "development-insecure-public-id-key-change-before-production";
}

/**
 * Opaque selection token for a co-stream group.
 *
 * The internal key is `scope:creatorKey:teamKey:matchExternalId`, so returning it would keep
 * publishing the team and match linkage even after those fields were removed from the DTO.
 * This is a routing token, not an authorization primitive — it is public by design, and the
 * `cs1_` prefix lets a future algorithm coexist with links already in the wild.
 */
export function publicCoStreamId(internalGroupId: string): string {
  return (
    PUBLIC_ID_PREFIX + createHmac("sha256", publicIdKey()).update(internalGroupId).digest("base64url")
  );
}

/** A value only counts as a selection token if it was issued as one. */
export function isPublicCoStreamId(value: string): boolean {
  return value.startsWith(PUBLIC_ID_PREFIX);
}

/**
 * Keeps only values that are already public tokens. Caller-supplied input is NEVER passed to
 * `publicCoStreamId`.
 *
 * This used to translate a legacy raw group key from an older share link into its token, which
 * turned the endpoint into an HMAC oracle: `?stream=<guess>` had the server compute the real
 * digest of an attacker-chosen string and hand it back through the page. Comparing that against
 * the tokens in the public listing confirms a guessed `scope:creator:team:match` outright, so
 * the key bought nothing — the server was doing the offline work on request.
 *
 * Matching guesses against the real group set instead would be the same oracle: a correct guess
 * still reveals which token it belongs to. Only issued tokens are accepted, so an old raw link
 * now lands on the page without a preselection rather than leaking the linkage it encodes.
 */
export function resolvePublicCoStreamIds(requestedIds: string[]): string[] {
  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const requestedId of requestedIds) {
    if (!isPublicCoStreamId(requestedId) || seen.has(requestedId)) continue;
    seen.add(requestedId);
    resolved.push(requestedId);
  }
  return resolved;
}

function projectChannel(channel: CoStreamChannel): PublicCoStreamChannel {
  return {
    platform: channel.platform,
    handle: channel.handle,
    label: channel.label,
    scope: channel.scope,
    gameSlugs: channel.gameSlugs.slice(),
    language: channel.language,
    isDefault: channel.isDefault,
    isLive: channel.isLive,
    liveTitle: channel.liveTitle,
    liveGame: channel.liveGame,
    viewerCount: channel.viewerCount,
    startedAt: channel.startedAt,
    url: channel.url,
    videoId: channel.videoId,
  };
}

function projectStream(stream: CoStream): PublicCoStream {
  return {
    id: publicCoStreamId(stream.id),
    label: stream.label,
    creatorKey: stream.creatorKey,
    gameSlugs: stream.gameSlugs.slice(),
    language: stream.language,
    isLive: stream.isLive,
    liveTitle: stream.liveTitle,
    liveGame: stream.liveGame,
    viewerCount: stream.viewerCount,
    startedAt: stream.startedAt,
    channels: stream.channels.map(projectChannel),
    // Projected separately rather than reused by reference: the embed channel is the same
    // object as a member of `channels`, so sharing it would publish one unprojected record.
    embedChannel: stream.embedChannel ? projectChannel(stream.embedChannel) : null,
  };
}

export function projectPublicCoStreams(streams: CoStream[]): PublicCoStream[] {
  return streams.map(projectStream);
}

// Projection happens INSIDE the cached callback, so no raw group is ever written to the
// public cache entry. Live status is refreshed by the bot poller roughly every 60s.
export const getAllPublicCoStreamsCached = unstable_cache(
  async () => projectPublicCoStreams(await getAllCoStreams()),
  ["all-public-co-streams"],
  { revalidate: 30 },
);

export const getEwcPublicCoStreamsCached = unstable_cache(
  async () => projectPublicCoStreams(await getEwcCoStreams()),
  ["ewc-public-co-streams"],
  { revalidate: 30 },
);

/** Cheap header signal: how many co-stream groups are live right now. */
export async function countLiveCoStreams(): Promise<number> {
  const streams = await getAllPublicCoStreamsCached();
  return streams.filter((stream) => stream.isLive).length;
}
