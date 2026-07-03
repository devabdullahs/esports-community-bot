/**
 * Comment reporting + moderator inline view.
 * Mocks the membership gate (@/lib/community) and admin gate (@/lib/admin);
 * the DB, reporting, auto-hide, and moderation below are real against the temp DB.
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { nonAdmin, superAdmin } from "./access";

vi.mock("@/lib/community", () => ({
  requireVerifiedMember: vi.fn(),
  getCommunityMember: vi.fn(),
  sameOriginOr403: () => null, // allow same-origin in tests
  clientIp: () => "report-test-ip",
}));
vi.mock("@/lib/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin")>();
  return { ...actual, getAdminAccess: vi.fn() };
});

import { requireVerifiedMember, getCommunityMember } from "@/lib/community";
import { getAdminAccess } from "@/lib/admin";
import { POST as reportRoute } from "@/app/api/comments/[id]/report/route";
import { GET as getComments } from "@/app/api/news/[postId]/comments/route";
import { GET as adminComments } from "@/app/api/admin/comments/route";
import { POST as moderate } from "@/app/api/admin/comments/[id]/moderate/route";

const mockMember = vi.mocked(requireVerifiedMember);
const mockGetMember = vi.mocked(getCommunityMember);
const mockAdmin = vi.mocked(getAdminAccess);

function verified(id: string) {
  return {
    member: { authUserId: `auth-${id}`, discordUserId: id, displayName: "M", inGuild: true, isVerified: true },
  };
}
function ctx(params: Record<string, string>) {
  return { params: Promise.resolve(params) };
}
function reportReq(id: number, body: unknown) {
  return new Request(`http://localhost/api/comments/${id}/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost", host: "localhost" },
    body: JSON.stringify(body),
  });
}
function getReq(postId: number) {
  return new Request(`http://localhost/api/news/${postId}/comments`, { method: "GET", headers: { host: "localhost" } });
}
function modReq(id: number, action: string) {
  return new Request(`http://localhost/api/admin/comments/${id}/moderate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost", host: "localhost" },
    body: JSON.stringify({ action }),
  });
}

type PublicComment = { id: number; status: string; reportCount: number; isDeleted: boolean };

let postId: number;
let commentId: number;

beforeAll(async () => {
  const { createEwcNewsPost } = await import("@bot/db/ewcNewsPosts.js");
  const { createComment } = await import("@bot/db/postComments.js");
  const post = (await createEwcNewsPost({
    gameSlug: "valorant",
    contentMode: "shared",
    defaultLocale: "en",
    translations: { en: { title: "T", summary: "S", body: "B" } },
    status: "published",
  })) as { id: number };
  postId = post.id;
  const res = (await createComment({
    postId,
    authUserId: "auth-author",
    discordUserId: "author",
    authorName: "Author",
    body: "reportable comment",
  })) as { comment: { id: number } };
  commentId = res.comment.id;
});

beforeEach(() => {
  // Default: a signed-in non-admin viewer.
  mockGetMember.mockResolvedValue({ session: {}, member: null } as never);
  mockAdmin.mockResolvedValue(nonAdmin());
});

describe("POST /api/comments/:id/report", () => {
  test("a verified member can report someone else's comment", async () => {
    mockMember.mockResolvedValue(verified("reporter-1") as never);
    const res = await reportRoute(reportReq(commentId, { reason: "spam" }), ctx({ id: String(commentId) }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, created: true, held: false });
  });

  test("a repeat report by the same user is a no-op (created: false)", async () => {
    mockMember.mockResolvedValue(verified("reporter-1") as never);
    const res = await reportRoute(reportReq(commentId, { reason: "harassment" }), ctx({ id: String(commentId) }));
    expect(res.status).toBe(200);
    expect((await res.json()).created).toBe(false);
  });

  test("you can't report your own comment", async () => {
    mockMember.mockResolvedValue(verified("author") as never);
    const res = await reportRoute(reportReq(commentId, { reason: "spam" }), ctx({ id: String(commentId) }));
    expect(res.status).toBe(400);
  });

  test("an invalid reason is rejected", async () => {
    mockMember.mockResolvedValue(verified("reporter-x") as never);
    const res = await reportRoute(reportReq(commentId, { reason: "bogus" }), ctx({ id: String(commentId) }));
    expect(res.status).toBe(400);
  });

  test("unverified members are gated out", async () => {
    mockMember.mockResolvedValue({ response: new Response(null, { status: 403 }) } as never);
    const res = await reportRoute(reportReq(commentId, { reason: "spam" }), ctx({ id: String(commentId) }));
    expect(res.status).toBe(403);
  });
});

describe("auto-hide + moderator inline view", () => {
  test("the third distinct report auto-hides the comment; mods still see it, the public doesn't", async () => {
    // reporter-1 already reported above; add two more distinct reporters.
    for (const r of ["reporter-2", "reporter-3"]) {
      mockMember.mockResolvedValue(verified(r) as never);
      await reportRoute(reportReq(commentId, { reason: "hate" }), ctx({ id: String(commentId) }));
    }
    // The third report crosses the default threshold (3) and holds the comment.
    // Public viewer (non-admin) no longer sees it.
    const publicRes = await getComments(getReq(postId), ctx({ postId: String(postId) }));
    const publicJson = await publicRes.json();
    expect(publicJson.viewer.canModerate).toBe(false);
    expect(publicJson.comments.find((c: PublicComment) => c.id === commentId)).toBeUndefined();

    // A moderator sees it inline, held (pending) with a report count.
    mockAdmin.mockResolvedValue(superAdmin());
    const modRes = await getComments(getReq(postId), ctx({ postId: String(postId) }));
    const modJson = await modRes.json();
    expect(modJson.viewer.canModerate).toBe(true);
    const held = modJson.comments.find((c: PublicComment) => c.id === commentId);
    expect(held).toBeDefined();
    expect(held.status).toBe("pending");
    expect(held.reportCount).toBe(3);
  });

  test("a moderator restore clears the open reports; the reported queue empties", async () => {
    mockAdmin.mockResolvedValue(superAdmin());

    // Before: the comment is in the reported queue.
    const before = await adminComments(new Request("http://localhost/api/admin/comments?status=reported"));
    const beforeJson = await before.json();
    expect(beforeJson.comments.some((c: PublicComment) => c.id === commentId)).toBe(true);
    expect(beforeJson.counts.reported).toBeGreaterThan(0);

    // Restore it -> back to visible, reports resolved.
    const modRes = await moderate(modReq(commentId, "restore"), ctx({ id: String(commentId) }));
    expect(modRes.status).toBe(200);

    const after = await adminComments(new Request("http://localhost/api/admin/comments?status=reported"));
    const afterJson = await after.json();
    expect(afterJson.comments.some((c: PublicComment) => c.id === commentId)).toBe(false);
    expect(afterJson.counts.reported).toBe(0);
  });
});
