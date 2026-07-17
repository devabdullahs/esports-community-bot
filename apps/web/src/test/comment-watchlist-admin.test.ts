import { describe, expect, test, vi } from "vitest";
import { anonymous, gamesAdmin, superAdmin } from "./access";

vi.mock("@/lib/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin")>();
  return { ...actual, getAdminAccess: vi.fn() };
});

import { getAdminAccess } from "@/lib/admin";
import { GET as keywordRulesGET, POST as keywordRulesPOST } from "@/app/api/admin/comments/keyword-rules/route";
import { PATCH as keywordRulePATCH } from "@/app/api/admin/comments/keyword-rules/[id]/route";
import { POST as bulkPOST } from "@/app/api/admin/comments/bulk/route";

const mockAccess = vi.mocked(getAdminAccess);

function request(method = "GET", body?: unknown): Request {
  const headers: Record<string, string> = { Origin: "http://localhost", Host: "localhost" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    return new Request("http://localhost/api/admin/comments/test", { method, headers, body: JSON.stringify(body) });
  }
  return new Request("http://localhost/api/admin/comments/test", { method, headers });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function seedComments() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const { createEwcGame } = await import("@bot/db/ewcGames.js") as {
    createEwcGame: (input: unknown) => Promise<unknown>;
  };
  const { createEwcNewsPost } = await import("@bot/db/ewcNewsPosts.js") as {
    createEwcNewsPost: (input: unknown) => Promise<{ id: number }>;
  };
  const { createComment } = await import("@bot/db/postComments.js") as {
    createComment: (input: unknown) => Promise<{ comment: { id: number } }>;
  };
  const gameSlug = `watchlist-${suffix}`;
  await createEwcGame({
    slug: gameSlug,
    title: { en: gameSlug, ar: gameSlug },
    description: { en: "", ar: "" },
    status: { en: "", ar: "" },
    owner: { en: "", ar: "" },
    focus: [],
  });
  const post = await createEwcNewsPost({
    gameSlug,
    contentMode: "shared",
    defaultLocale: "en",
    translations: { en: { title: "T", summary: "S", body: "B" } },
    status: "published",
    authorDiscordId: null,
    authorName: null,
    coverImageUrl: null,
  });
  const first = await createComment({
    postId: post.id, authUserId: `auth-${suffix}-1`, discordUserId: `user-${suffix}-1`, authorName: "One", body: "one",
  });
  const second = await createComment({
    postId: post.id, authUserId: `auth-${suffix}-2`, discordUserId: `user-${suffix}-2`, authorName: "Two", body: "two",
  });
  return { postId: post.id, firstId: first.comment.id, secondId: second.comment.id };
}

describe("keyword watchlist admin APIs", () => {
  test("super admins create, update, disable, and reject duplicate or invalid rules", async () => {
    mockAccess.mockResolvedValue(superAdmin());
    const phrase = `watch-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const invalid = await keywordRulesPOST(request("POST", { phrase: "x".repeat(161), action: "hold" }));
    expect(invalid.status).toBe(400);

    const created = await keywordRulesPOST(request("POST", {
      phrase: ` ${phrase} `, locale: "en", scope: "news", action: "hold",
    }));
    expect(created.status).toBe(201);
    const rule = (await created.json()).rule as { id: number; phrase: string; enabled: boolean };
    expect(rule).toMatchObject({ phrase, enabled: true });

    const duplicate = await keywordRulesPOST(request("POST", {
      phrase: phrase.toUpperCase(), locale: "en", scope: "news", action: "flag",
    }));
    expect(duplicate.status).toBe(409);

    const updated = await keywordRulePATCH(
      request("PATCH", { action: "flag", enabled: false, scope: "match" }),
      context(String(rule.id)),
    );
    expect(updated.status).toBe(200);
    expect((await updated.json()).rule).toMatchObject({ action: "flag", enabled: false, scope: "match" });

    const listed = await keywordRulesGET();
    expect(listed.status).toBe(200);
    expect(((await listed.json()).rules as Array<{ id: number }>).some((candidate) => candidate.id === rule.id)).toBe(true);
  });

  test("watchlist and bulk APIs reject anonymous and scoped admins", async () => {
    mockAccess.mockResolvedValue(anonymous());
    expect((await keywordRulesGET()).status).toBe(401);

    mockAccess.mockResolvedValue(gamesAdmin(["valorant"]));
    expect((await keywordRulesGET()).status).toBe(403);
    expect((await bulkPOST(request("POST", { ids: [1], action: "hold" }))).status).toBe(403);
  });

  test("bulk hold is best-effort, per-comment audited, and reports invalid ids", async () => {
    mockAccess.mockResolvedValue(superAdmin());
    const { firstId, secondId } = await seedComments();
    const response = await bulkPOST(request("POST", {
      ids: [firstId, "not-an-id", 999999999, firstId, secondId],
      action: "hold",
    }));
    expect(response.status).toBe(200);
    const result = await response.json() as {
      updated: Array<{ id: number; status: string }>;
      failed: Array<{ id: string | number; error: string }>;
    };
    expect(result.updated).toEqual(expect.arrayContaining([
      { id: firstId, status: "pending" },
      { id: secondId, status: "pending" },
    ]));
    expect(result.failed).toEqual(expect.arrayContaining([
      { id: "not-an-id", error: "invalid-id" },
      { id: 999999999, error: "not-found" },
      { id: firstId, error: "duplicate-id" },
    ]));

    const { getComment } = await import("@bot/db/postComments.js") as {
      getComment: (id: number) => Promise<{ status: string; autoApproveAt: number | null }>;
    };
    const { listCommentModerationActions } = await import("@bot/db/commentModerationActions.js") as {
      listCommentModerationActions: (id: number) => Promise<Array<{ action: string; moderator_discord_id: string }>>;
    };
    expect(await getComment(firstId)).toMatchObject({ status: "pending", autoApproveAt: null });
    for (const id of [firstId, secondId]) {
      expect(await listCommentModerationActions(id)).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: "hold", moderator_discord_id: superAdmin().discordUserId }),
      ]));
    }

    await new Promise((resolve) => setImmediate(resolve));
    const { listAdminAuditLog } = await import("@bot/db/ewcAdminAuditLog.js") as unknown as {
      listAdminAuditLog: () => Promise<Array<{ action: string; target: string | null; actorId: string }>>;
    };
    const auditRows = (await listAdminAuditLog()).filter((row) => row.action === "comment.bulk.hold");
    expect(auditRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: String(firstId), actorId: superAdmin().discordUserId }),
      expect.objectContaining({ target: String(secondId), actorId: superAdmin().discordUserId }),
    ]));
  });

  test("bulk actions cannot resurrect a deleted comment", async () => {
    mockAccess.mockResolvedValue(superAdmin());
    const { firstId } = await seedComments();
    const { setCommentStatus, getComment } = await import("@bot/db/postComments.js") as {
      setCommentStatus: (id: number, status: string, input: unknown) => Promise<unknown>;
      getComment: (id: number) => Promise<{ status: string; deletedAt: string | null }>;
    };
    await setCommentStatus(firstId, "deleted", { deletedBy: "author" });

    const response = await bulkPOST(request("POST", { ids: [firstId], action: "approve" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      updated: [],
      failed: [{ id: firstId, error: "invalid-status" }],
    });
    expect(await getComment(firstId)).toMatchObject({ status: "deleted" });
  });

  test("enabled rules are applied to comment create and edit", async () => {
    mockAccess.mockResolvedValue(superAdmin());
    const { postId } = await seedComments();
    const phrase = `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const { createCommentKeywordRule } = await import("@bot/db/commentKeywordRules.js") as {
      createCommentKeywordRule: (input: unknown) => Promise<unknown>;
    };
    await createCommentKeywordRule({
      phrase, locale: "en", scope: "news", action: "hold", createdBy: superAdmin().discordUserId,
    });
    const { createPostComment, editOwnComment } = await import("@/lib/comments") as {
      createPostComment: (input: unknown) => Promise<{ comment: { id: number; status: string; flagReason: unknown; autoApproveAt: number | null } }>;
      editOwnComment: (id: number, body: string) => Promise<{ status: string; flagReason: unknown; autoApproveAt: number | null } | null>;
    };
    const created = await createPostComment({
      postId, authUserId: `watch-auth-${phrase}`, discordUserId: `watch-user-${phrase}`, authorName: "Watch", body: phrase,
    });
    expect(created.comment).toMatchObject({ status: "pending", autoApproveAt: null });
    expect(created.comment.flagReason).toMatchObject({ keywordRules: [{ phrase, action: "hold" }] });

    const clean = await createPostComment({
      postId, authUserId: `watch-edit-auth-${phrase}`, discordUserId: `watch-edit-user-${phrase}`, authorName: "Edit", body: "clean",
    });
    expect(clean.comment.status).toBe("visible");
    const edited = await editOwnComment(clean.comment.id, phrase);
    expect(edited).toMatchObject({ status: "pending", autoApproveAt: null, flagReason: { keywordRules: [{ phrase, action: "hold" }] } });
  });
});
