/**
 * Match discussion threads use the same comment, report, like, and moderation
 * primitives as news. These route tests exercise the match-specific existence
 * boundary while keeping the shared DB layer real.
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { nonAdmin, superAdmin } from "./access";

vi.mock("@/lib/community", () => ({
  requireVerifiedMember: vi.fn(),
  getCommunityMember: vi.fn(),
  sameOriginOr403: () => null,
  clientIp: () => "match-comment-test-ip",
}));
vi.mock("@/lib/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin")>();
  return { ...actual, getAdminAccess: vi.fn() };
});
vi.mock("@/lib/guild", () => ({ resolveDefaultGuildId: vi.fn() }));

import { requireVerifiedMember, getCommunityMember } from "@/lib/community";
import { getAdminAccess } from "@/lib/admin";
import { resolveDefaultGuildId } from "@/lib/guild";
import { GET as getMatchComments, POST as postMatchComment } from "@/app/api/matches/[id]/comments/route";
import { POST as reportComment } from "@/app/api/comments/[id]/report/route";
import { PUT as likeComment } from "@/app/api/comments/[id]/like/route";
import { GET as adminComments } from "@/app/api/admin/comments/route";

const mockMember = vi.mocked(requireVerifiedMember);
const mockGetMember = vi.mocked(getCommunityMember);
const mockAdmin = vi.mocked(getAdminAccess);
const mockGuild = vi.mocked(resolveDefaultGuildId);

const GUILD_ID = "match-comments-guild";

function verified(discordUserId: string) {
  return {
    member: {
      authUserId: `auth-${discordUserId}`,
      discordUserId,
      displayName: "Verified member",
      inGuild: true,
      isVerified: true,
      avatarUrl: null,
    },
  };
}

function ctx(id: number | string) {
  return { params: Promise.resolve({ id: String(id) }) };
}

function commentRequest(matchId: number, body: unknown) {
  return new Request(`http://localhost/api/matches/${matchId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost", host: "localhost" },
    body: JSON.stringify(body),
  });
}

let matchId: number;

beforeAll(async () => {
  mockGuild.mockResolvedValue(GUILD_ID);
  const { addTournament } = await import("@bot/db/tournaments.js");
  const { upsertMatch } = await import("@bot/db/matches.js");
  const tournament = await addTournament({
    source: "liquipedia",
    external_id: "match-comments-test-tournament",
    game: "valorant",
    name: "Match comments test",
    guild_id: GUILD_ID,
  }) as { id: number };
  const match = await upsertMatch({
    tournament_id: tournament.id,
    source: "liquipedia",
    external_id: "match-comments-test-match",
    name: "Team Alpha vs Team Beta",
    team_a: "Team Alpha",
    team_b: "Team Beta",
    status: "scheduled",
    scheduled_at: Math.floor(Date.now() / 1000) + 3600,
  }) as { id: number };
  matchId = match.id;
});

beforeEach(() => {
  mockGuild.mockResolvedValue(GUILD_ID);
  mockAdmin.mockResolvedValue(nonAdmin());
  mockGetMember.mockResolvedValue({ session: null, member: null } as never);
});

describe("/api/matches/:id/comments", () => {
  test("does not allow an anonymous write", async () => {
    mockMember.mockResolvedValue({ response: new Response(null, { status: 401 }) } as never);
    const response = await postMatchComment(commentRequest(matchId, { body: "hello" }), ctx(matchId));
    expect(response.status).toBe(401);
  });

  test("returns 404 for a missing match before it creates a thread", async () => {
    mockMember.mockResolvedValue(verified("missing-match-member") as never);
    const response = await postMatchComment(commentRequest(999999999, { body: "hello" }), ctx(999999999));
    expect(response.status).toBe(404);
  });

  test("validates a match comment and stores it as a match target", async () => {
    mockMember.mockResolvedValue(verified("match-author") as never);
    const invalid = await postMatchComment(commentRequest(matchId, { body: "   " }), ctx(matchId));
    expect(invalid.status).toBe(400);

    const created = await postMatchComment(commentRequest(matchId, { body: "Looking forward to this series." }), ctx(matchId));
    expect(created.status).toBe(201);
    const { comment } = await created.json();

    const { getComment } = await import("@bot/db/postComments.js");
    const stored = await getComment(comment.id) as { targetType: string; targetId: number; postId: number | null };
    expect(stored).toMatchObject({ targetType: "match", targetId: matchId, postId: null });
  });

  test("shared report, like, and moderation paths work for a match comment", async () => {
    const { createComment } = await import("@bot/db/postComments.js");
    const created = await createComment({
      targetType: "match",
      targetId: matchId,
      authUserId: "auth-match-report-author",
      discordUserId: "match-report-author",
      body: "Report and like me",
    }) as { comment: { id: number } };
    const commentId = created.comment.id;

    mockMember.mockResolvedValue(verified("match-reporter") as never);
    const report = await reportComment(
      new Request(`http://localhost/api/comments/${commentId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: "http://localhost", host: "localhost" },
        body: JSON.stringify({ reason: "spam" }),
      }),
      { params: Promise.resolve({ id: String(commentId) }) },
    );
    expect(report.status).toBe(200);

    const liked = await likeComment(
      new Request(`http://localhost/api/comments/${commentId}/like`, {
        method: "PUT",
        headers: { origin: "http://localhost", host: "localhost" },
      }),
      { params: Promise.resolve({ id: String(commentId) }) },
    );
    expect(liked.status).toBe(200);

    mockAdmin.mockResolvedValue(superAdmin());
    const queue = await adminComments(new Request("http://localhost/api/admin/comments?status=reported"));
    const json = await queue.json();
    expect(json.comments).toContainEqual(expect.objectContaining({ id: commentId, targetType: "match", targetId: matchId }));
  });

  test("GET exposes only the match target thread", async () => {
    const response = await getMatchComments(
      new Request(`http://localhost/api/matches/${matchId}/comments`, { headers: { host: "localhost" } }),
      ctx(matchId),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.comments.length).toBeGreaterThan(0);
    expect(json).not.toHaveProperty("postLike");
  });
});
