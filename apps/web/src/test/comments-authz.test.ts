/**
 * Auth + rate-limit matrix for the community comment routes.
 * Mocks the membership gate (@/lib/community) and admin gate (@/lib/admin);
 * everything below (DB, moderation, rate limiting) is real against the temp DB.
 */
import { beforeAll, describe, expect, test, vi } from "vitest";
import { nonAdmin, superAdmin } from "./access";

vi.mock("@/lib/community", () => ({
  requireVerifiedMember: vi.fn(),
  getCommunityMember: vi.fn(),
  sameOriginOr403: () => null, // allow same-origin in tests
  clientIp: () => "test-ip",
}));
vi.mock("@/lib/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin")>();
  return { ...actual, getAdminAccess: vi.fn() };
});

import { requireVerifiedMember, getCommunityMember } from "@/lib/community";
import { getAdminAccess } from "@/lib/admin";
import { POST as postComment, GET as getComments } from "@/app/api/news/[postId]/comments/route";
import { GET as adminComments } from "@/app/api/admin/comments/route";
import { POST as moderate } from "@/app/api/admin/comments/[id]/moderate/route";

const mockMember = vi.mocked(requireVerifiedMember);
const mockGetMember = vi.mocked(getCommunityMember);
const mockAdmin = vi.mocked(getAdminAccess);

function verified(discordUserId: string) {
  return { member: { authUserId: `auth-${discordUserId}`, discordUserId, displayName: "Member", inGuild: true, isVerified: true } };
}
function commentReq(postId: number, body: string) {
  return new Request(`http://localhost/api/news/${postId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost", host: "localhost" },
    body: JSON.stringify({ body }),
  });
}
function ctx(params: Record<string, string>) {
  return { params: Promise.resolve(params) };
}

let postId: number;
beforeAll(async () => {
  const { createEwcNewsPost } = await import("@bot/db/ewcNewsPosts.js");
  const post = (await createEwcNewsPost({
    gameSlug: "valorant",
    contentMode: "shared",
    defaultLocale: "en",
    translations: { en: { title: "T", summary: "S", body: "B" } },
    status: "published",
  })) as { id: number };
  postId = post.id;
});

describe("POST /api/news/:postId/comments — auth states", () => {
  test("anonymous -> 401", async () => {
    mockMember.mockResolvedValue({ response: new Response(null, { status: 401 }) } as never);
    const res = await postComment(commentReq(postId, "hi"), ctx({ postId: String(postId) }));
    expect(res.status).toBe(401);
  });

  test("signed-in but unverified -> 403", async () => {
    mockMember.mockResolvedValue({ response: new Response(null, { status: 403 }) } as never);
    const res = await postComment(commentReq(postId, "hi"), ctx({ postId: String(postId) }));
    expect(res.status).toBe(403);
  });

  test("verified -> 201 and the comment is stored", async () => {
    mockMember.mockResolvedValue(verified("d-create") as never);
    const res = await postComment(commentReq(postId, "great game!"), ctx({ postId: String(postId) }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.comment.status).toBe("visible");
  });

  test("clean comment is visible, link comment is held pending", async () => {
    mockMember.mockResolvedValue(verified("d-pending") as never);
    const link = await (await postComment(commentReq(postId, "join https://sketchy.example"), ctx({ postId: String(postId) }))).json();
    expect(link.comment.status).toBe("pending");
  });

  test("rate limit: 6th comment in the window -> 429 with Retry-After", async () => {
    mockMember.mockResolvedValue(verified("d-rate") as never);
    let last: Response | null = null;
    for (let i = 0; i < 6; i++) {
      last = await postComment(commentReq(postId, `c${i}`), ctx({ postId: String(postId) }));
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("POST /api/admin/comments/:id/moderate — moderator gate", () => {
  let commentId: number;
  beforeAll(async () => {
    const { createComment } = await import("@bot/db/postComments.js");
    const r = (await createComment({ postId, authUserId: "a", discordUserId: "d", body: "moderate me" })) as { comment: { id: number } };
    commentId = r.comment.id;
  });

  function modReq(action: string) {
    return new Request(`http://localhost/api/admin/comments/${commentId}/moderate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "http://localhost", host: "localhost" },
      body: JSON.stringify({ action }),
    });
  }

  test("non-admin -> 403", async () => {
    mockAdmin.mockResolvedValue(nonAdmin());
    const res = await moderate(modReq("hide"), ctx({ id: String(commentId) }));
    expect(res.status).toBe(403);
  });

  test("admin can hide any comment -> 200 + status changes", async () => {
    mockAdmin.mockResolvedValue(superAdmin());
    const res = await moderate(modReq("hide"), ctx({ id: String(commentId) }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.comment.status).toBe("hidden");
  });
});

describe("comment privacy + admin auto-approval (Codex review)", () => {
  test("public comments JSON does not leak discordUserId", async () => {
    mockGetMember.mockResolvedValue({ session: null, member: null });
    const { createComment } = await import("@bot/db/postComments.js");
    await createComment({ postId, authUserId: "a", discordUserId: "private-snowflake", body: "a public comment" });

    const res = await getComments(
      new Request(`http://localhost/api/news/${postId}/comments`),
      ctx({ postId: String(postId) }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.comments.length).toBeGreaterThan(0);
    const raw = JSON.stringify(json.comments);
    expect(raw).not.toContain("discordUserId");
    expect(raw).not.toContain("private-snowflake");
  });

  test("admin queue sweeps due link-only pending comments before listing", async () => {
    mockAdmin.mockResolvedValue(superAdmin());
    const { createComment, getComment } = await import("@bot/db/postComments.js");
    const past = Math.floor(Date.now() / 1000) - 60;
    const due = (await createComment({
      postId, authUserId: "a", discordUserId: "d", body: "see https://site.example",
      status: "pending", flagReason: { links: ["site.example"] }, autoApproveAt: past,
    })) as { comment: { id: number } };
    expect((await getComment(due.comment.id)).status).toBe("pending");

    const res = await adminComments(new Request("http://localhost/api/admin/comments?status=pending"));
    expect(res.status).toBe(200);
    // The route ran the auto-approval sweep first, so the due comment is now visible.
    expect((await getComment(due.comment.id)).status).toBe("visible");
  });
});
