/**
 * A moderator's hide/reject must survive an author edit. The PATCH edit route
 * recomputes status from the new body via editOwnComment, so without a guard an
 * author could PATCH clean text into a hidden/rejected comment and silently
 * un-hide it. These tests assert the route refuses (403) and the stored status
 * is unchanged, while a normal (visible/pending) edit still succeeds.
 *
 * Mirrors comments-authz.test.ts: mocks the membership gate (@/lib/community),
 * everything below (DB, moderation recompute) is real against the temp DB.
 * Comments are seeded directly with an explicit status via the bot DB layer
 * (@bot/db/postComments.js) — the plan permits setting status directly rather
 * than driving the admin moderation gate, which is out of scope here.
 */
import { beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/community", () => ({
  requireVerifiedMember: vi.fn(),
  getCommunityMember: vi.fn(),
  sameOriginOr403: () => null, // allow same-origin in tests
  clientIp: () => "test-ip",
}));

import { requireVerifiedMember } from "@/lib/community";
import { PATCH } from "@/app/api/comments/[id]/route";

const mockMember = vi.mocked(requireVerifiedMember);

const OWNER = "d-owner";

function verified(discordUserId: string) {
  return { member: { authUserId: `auth-${discordUserId}`, discordUserId, displayName: "Member", inGuild: true, isVerified: true } };
}
function ctx(id: number) {
  return { params: Promise.resolve({ id: String(id) }) };
}
function editReq(id: number, body: string) {
  return new Request(`http://localhost/api/comments/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", origin: "http://localhost", host: "localhost" },
    body: JSON.stringify({ body }),
  });
}

type CommentStatus = "visible" | "pending" | "hidden" | "rejected" | "deleted";

let postId: number;
let createComment: (i: Record<string, unknown>) => Promise<{ comment: { id: number } } | { error: string }>;
let getComment: (id: number) => Promise<{ id: number; status: CommentStatus; body: string } | null>;

async function seedComment(status: CommentStatus): Promise<number> {
  const r = (await createComment({
    postId,
    authUserId: `auth-${OWNER}`,
    discordUserId: OWNER,
    body: "original comment text",
    status,
  })) as { comment: { id: number } };
  return r.comment.id;
}

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

  const postComments = await import("@bot/db/postComments.js");
  createComment = postComments.createComment as typeof createComment;
  getComment = postComments.getComment as typeof getComment;
});

describe("PATCH /api/comments/:id — moderated comments cannot be edited", () => {
  test("hidden comment -> 403 and status stays hidden", async () => {
    mockMember.mockResolvedValue(verified(OWNER) as never);
    const id = await seedComment("hidden");

    const res = await PATCH(editReq(id, "totally clean replacement text"), ctx(id));
    expect(res.status).toBe(403);

    const after = await getComment(id);
    expect(after?.status).toBe("hidden");
    expect(after?.body).toBe("original comment text"); // body untouched too
  });

  test("rejected comment -> 403 and status stays rejected", async () => {
    mockMember.mockResolvedValue(verified(OWNER) as never);
    const id = await seedComment("rejected");

    const res = await PATCH(editReq(id, "totally clean replacement text"), ctx(id));
    expect(res.status).toBe(403);

    const after = await getComment(id);
    expect(after?.status).toBe("rejected");
    expect(after?.body).toBe("original comment text");
  });

  test("visible comment owned by the member -> edit succeeds (200)", async () => {
    mockMember.mockResolvedValue(verified(OWNER) as never);
    const id = await seedComment("visible");

    const res = await PATCH(editReq(id, "an edited but still clean comment"), ctx(id));
    expect(res.status).toBe(200);

    const after = await getComment(id);
    expect(after?.body).toBe("an edited but still clean comment");
    expect(after?.status).toBe("visible");
  });

  test("pending comment owned by the member -> edit succeeds (200)", async () => {
    mockMember.mockResolvedValue(verified(OWNER) as never);
    const id = await seedComment("pending");

    const res = await PATCH(editReq(id, "another clean edit goes through"), ctx(id));
    expect(res.status).toBe(200);

    const after = await getComment(id);
    expect(after?.body).toBe("another clean edit goes through");
  });
});
