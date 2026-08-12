import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  projectPublicCoStreams,
  publicCoStreamId,
  resolvePublicCoStreamIds,
} from "@/lib/public-co-streams";
import type { CoStream, CoStreamChannel } from "@/lib/stream-types";

// Sentinels, never real values. Each stands for one class of internal data that reached
// anonymous responses: the administrator's Discord ID, the database row ID, audit
// timestamps, ordering/active flags, and the team/match linkage the group key encoded.
const PRIVATE_ADMIN_ID = "PRIVATE-ADDED-BY-000000000000000000";
const PRIVATE_TEAM_KEY = "PRIVATE-TEAM-KEY";
const PRIVATE_MATCH_ID = "PRIVATE-MATCH-EXTERNAL-ID";
const PRIVATE_CREATED_AT = "1999-01-01T00:00:00.000Z";
const PRIVATE_UPDATED_AT = "1999-01-02T00:00:00.000Z";
const PRIVATE_FUTURE_FIELD = "PRIVATE-FIELD-ADDED-LATER";

const PUBLIC_CHANNEL_KEYS = [
  "platform",
  "handle",
  "label",
  "scope",
  "gameSlugs",
  "language",
  "isDefault",
  "isLive",
  "liveTitle",
  "liveGame",
  "viewerCount",
  "startedAt",
  "url",
  "videoId",
].sort();

const PUBLIC_GROUP_KEYS = [
  "id",
  "label",
  "creatorKey",
  "gameSlugs",
  "language",
  "isLive",
  "liveTitle",
  "liveGame",
  "viewerCount",
  "startedAt",
  "channels",
  "embedChannel",
].sort();

function internalChannel(overrides: Partial<CoStreamChannel> = {}): CoStreamChannel {
  return {
    id: 424242,
    platform: "twitch",
    handle: "synthetic-handle",
    label: "Synthetic Co-streamer",
    scope: "ewc",
    creatorKey: "synthetic-creator",
    gameSlug: "valorant",
    gameSlugs: ["valorant"],
    teamKey: PRIVATE_TEAM_KEY,
    matchExternalId: PRIVATE_MATCH_ID,
    language: "en",
    sortOrder: 7,
    isDefault: true,
    active: true,
    addedBy: PRIVATE_ADMIN_ID,
    createdAt: PRIVATE_CREATED_AT,
    updatedAt: PRIVATE_UPDATED_AT,
    url: "https://twitch.tv/synthetic-handle",
    isLive: true,
    liveTitle: "Synthetic live title",
    liveGame: "Valorant",
    viewerCount: 12,
    startedAt: 1_780_000_000,
    videoId: null,
    ...overrides,
  };
}

const INTERNAL_GROUP_ID = `ewc:synthetic-creator:${PRIVATE_TEAM_KEY}:${PRIVATE_MATCH_ID}`;

function internalStream(): CoStream {
  const embed = internalChannel();
  return {
    id: INTERNAL_GROUP_ID,
    label: "Synthetic Co-streamer",
    creatorKey: "synthetic-creator",
    gameSlugs: ["valorant"],
    language: "en",
    channels: [embed, internalChannel({ platform: "kick", handle: "synthetic-kick", isDefault: false })],
    embedChannel: embed,
    isLive: true,
    liveTitle: "Synthetic live title",
    liveGame: "Valorant",
    viewerCount: 12,
    startedAt: 1_780_000_000,
    sortOrder: 7,
  };
}

describe("public co-stream projection", () => {
  test("emits exactly the documented public key sets", () => {
    const [projected] = projectPublicCoStreams([internalStream()]);

    expect(Object.keys(projected).sort()).toEqual(PUBLIC_GROUP_KEYS);
    for (const channel of projected.channels) {
      expect(Object.keys(channel).sort()).toEqual(PUBLIC_CHANNEL_KEYS);
    }
    expect(Object.keys(projected.embedChannel ?? {}).sort()).toEqual(PUBLIC_CHANNEL_KEYS);
  });

  test("no private sentinel survives serialization", () => {
    const serialized = JSON.stringify(projectPublicCoStreams([internalStream()]));

    for (const secret of [
      PRIVATE_ADMIN_ID,
      PRIVATE_TEAM_KEY,
      PRIVATE_MATCH_ID,
      PRIVATE_CREATED_AT,
      PRIVATE_UPDATED_AT,
    ]) {
      expect(serialized).not.toContain(secret);
    }
    // The database row ID and the ordering/active flags travel as values, not names.
    expect(serialized).not.toContain("424242");
    expect(serialized).not.toContain("addedBy");
    expect(serialized).not.toContain("sortOrder");
  });

  test("embedChannel is projected rather than shared with the channel it duplicates", () => {
    const [projected] = projectPublicCoStreams([internalStream()]);

    // Same data, different object: sharing the reference would publish one unprojected record
    // if the projector ever changed only one of the two paths.
    expect(projected.embedChannel).toEqual(projected.channels[0]);
    expect(projected.embedChannel).not.toBe(projected.channels[0]);
  });

  test("a field added to the internal record later is not published", () => {
    const stream = internalStream();
    const withFutureField = {
      ...stream,
      futureInternalField: PRIVATE_FUTURE_FIELD,
      channels: stream.channels.map((channel) => ({ ...channel, futureInternalField: PRIVATE_FUTURE_FIELD })),
    } as CoStream;

    const serialized = JSON.stringify(projectPublicCoStreams([withFutureField]));

    expect(serialized).not.toContain(PRIVATE_FUTURE_FIELD);
    expect(serialized).not.toContain("futureInternalField");
  });

  test("the public id is deterministic, versioned, and free of the raw group components", () => {
    const [first] = projectPublicCoStreams([internalStream()]);
    const [second] = projectPublicCoStreams([internalStream()]);

    expect(first.id).toBe(second.id);
    expect(first.id.startsWith("cs1_")).toBe(true);
    expect(first.id).not.toContain(PRIVATE_TEAM_KEY);
    expect(first.id).not.toContain(PRIVATE_MATCH_ID);
    expect(first.id).not.toContain("synthetic-creator");
    expect(first.id).not.toContain(":");
    expect(publicCoStreamId(INTERNAL_GROUP_ID)).toBe(first.id);
    // A different group must not collide onto the same selection token.
    expect(publicCoStreamId("ewc:other-creator::")).not.toBe(first.id);
  });

  test("a requested id is filtered, never translated, so there is no HMAC oracle", () => {
    const publicId = publicCoStreamId(INTERNAL_GROUP_ID);

    // Issued tokens pass through and de-duplicate.
    expect(resolvePublicCoStreamIds([publicId, publicId])).toEqual([publicId]);

    // The attack this forbids: `?stream=<guessed internal key>` must not come back as that
    // key's real token, which the visitor could then match against the public listing to
    // confirm the team/match linkage the DTO omits. A guess must produce nothing at all.
    const guesses = [
      INTERNAL_GROUP_ID,
      `ewc:synthetic-creator:${PRIVATE_TEAM_KEY}:${PRIVATE_MATCH_ID}`,
      "ewc:synthetic-creator::",
      "cs1",
      "",
    ];
    expect(resolvePublicCoStreamIds(guesses)).toEqual([]);
    for (const guess of guesses) {
      expect(resolvePublicCoStreamIds([guess, publicId])).toEqual([publicId]);
    }
  });

  test("the id is keyed, so the omitted linkage cannot be recovered by hashing candidates", () => {
    // Removing team/match linkage from the DTO achieves nothing if the token is a plain digest
    // of it: scope and creator are published, and team/match come from public tournament data,
    // so the candidate space is small enough to enumerate offline. Only a server-held key
    // makes a guessed group key unverifiable.
    const plainSha = createHash("sha256").update(INTERNAL_GROUP_ID).digest("base64url");
    expect(publicCoStreamId(INTERNAL_GROUP_ID)).not.toBe(`cs1_${plainSha}`);
    expect(publicCoStreamId(INTERNAL_GROUP_ID)).not.toContain(plainSha);

    const previous = process.env.EWC_PUBLIC_ID_SECRET;
    try {
      process.env.EWC_PUBLIC_ID_SECRET = "synthetic-key-a";
      const withKeyA = publicCoStreamId(INTERNAL_GROUP_ID);
      process.env.EWC_PUBLIC_ID_SECRET = "synthetic-key-b";
      const withKeyB = publicCoStreamId(INTERNAL_GROUP_ID);

      expect(withKeyA).not.toBe(withKeyB);
      // Stable for a fixed key: existing share links must keep resolving across restarts.
      process.env.EWC_PUBLIC_ID_SECRET = "synthetic-key-a";
      expect(publicCoStreamId(INTERNAL_GROUP_ID)).toBe(withKeyA);
    } finally {
      if (previous === undefined) delete process.env.EWC_PUBLIC_ID_SECRET;
      else process.env.EWC_PUBLIC_ID_SECRET = previous;
    }
  });
});
