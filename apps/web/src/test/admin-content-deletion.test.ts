import * as nextCache from "next/cache";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { anonymous, gamesAdmin, superAdmin } from "./access";

vi.mock("@/lib/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin")>();
  return { ...actual, getAdminAccess: vi.fn() };
});
vi.mock("@/lib/audit", () => ({ recordAdminAudit: vi.fn() }));

import { DELETE as deleteGameRoute } from "@/app/api/admin/games/[slug]/route";
import { DELETE as deleteMediaRoute } from "@/app/api/admin/media/[slug]/route";
import { getAdminAccess } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";

const mockAccess = vi.mocked(getAdminAccess);
const mockAudit = vi.mocked(recordAdminAudit);
const revalidateTag = vi.spyOn(nextCache, "revalidateTag");

function request(): Request {
  return new Request("http://localhost/api/admin/delete", {
    method: "DELETE",
    headers: {
      Origin: "http://localhost",
      Host: "localhost",
    },
  });
}

function context(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function createGame(slug: string): Promise<void> {
  const { createEwcGame } = await import("@bot/db/ewcGames.js");
  await createEwcGame({
    slug,
    title: { en: slug, ar: slug },
    description: { en: "", ar: "" },
    status: { en: "Active", ar: "Active" },
    owner: { en: "Owner", ar: "Owner" },
    focus: [],
  });
}

async function createChannel(slug: string, gameSlug: string | null = null): Promise<void> {
  const { createEwcMediaChannel } = await import("@bot/db/ewcMediaChannels.js");
  await createEwcMediaChannel({
    slug,
    name: { en: slug, ar: slug },
    description: { en: "", ar: "" },
    logoUrl: null,
    links: [],
    gameSlug,
  });
}

async function createPost({
  gameSlug = null,
  mediaSlug = null,
}: {
  gameSlug?: string | null;
  mediaSlug?: string | null;
}): Promise<number> {
  const { createEwcNewsPost } = await import("@bot/db/ewcNewsPosts.js");
  const post = await createEwcNewsPost({
    gameSlug,
    mediaSlug,
    status: "draft",
    contentMode: "shared",
    defaultLocale: "en",
    translations: {
      en: { title: "Deletion route test", summary: "Summary", body: "Body" },
    },
  }) as { id: number };
  return post.id;
}

describe("admin owner deletion routes", () => {
  beforeEach(() => {
    mockAccess.mockResolvedValue(superAdmin());
    mockAudit.mockClear();
    revalidateTag.mockClear();
  });

  test("preserves existing authentication and authorization failures", async () => {
    mockAccess.mockResolvedValueOnce(anonymous());
    expect((await deleteGameRoute(request(), context("missing"))).status).toBe(401);

    mockAccess.mockResolvedValueOnce(gamesAdmin(["valorant"]));
    expect((await deleteMediaRoute(request(), context("missing"))).status).toBe(403);

    expect(mockAudit).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  test("returns 404 without audit or invalidation when the game is absent", async () => {
    const response = await deleteGameRoute(request(), context(unique("missing-game")));
    expect(response.status).toBe(404);
    expect(mockAudit).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  test("game deletion returns and audits deleted and detached counts", async () => {
    const gameSlug = unique("route-game");
    const mediaSlug = unique("route-media");
    await createGame(gameSlug);
    await createChannel(mediaSlug, gameSlug);
    await createPost({ gameSlug });
    await createPost({ gameSlug, mediaSlug });

    const response = await deleteGameRoute(request(), context(gameSlug));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      gameDeleted: 1,
      postsDeleted: 1,
      mediaPostsDetached: 1,
      mediaChannelsDetached: 1,
    });
    expect(revalidateTag).toHaveBeenCalledWith("cms-games", "default");
    expect(revalidateTag).toHaveBeenCalledWith("cms-media", "default");
    expect(revalidateTag).toHaveBeenCalledWith("cms-news", "default");
    expect(mockAudit).toHaveBeenCalledWith(
      expect.anything(),
      "game.delete",
      gameSlug,
      {
        gameDeleted: 1,
        postsDeleted: 1,
        mediaPostsDetached: 1,
        mediaChannelsDetached: 1,
      },
    );
  });

  test("media deletion returns a side-effect-free 409 while posts exist", async () => {
    const mediaSlug = unique("blocked-media");
    await createChannel(mediaSlug);
    await createPost({ mediaSlug });

    const response = await deleteMediaRoute(request(), context(mediaSlug));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "media_has_posts",
      postCount: 1,
    });
    expect(mockAudit).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();

    const { getEwcMediaChannel } = await import("@bot/db/ewcMediaChannels.js");
    expect(await getEwcMediaChannel(mediaSlug)).not.toBeNull();
  });

  test("empty media deletion succeeds, audits, and invalidates public views", async () => {
    const mediaSlug = unique("empty-media");
    await createChannel(mediaSlug);

    const response = await deleteMediaRoute(request(), context(mediaSlug));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, deleted: 1 });
    expect(revalidateTag).toHaveBeenCalledWith("cms-media", "default");
    expect(revalidateTag).toHaveBeenCalledWith("cms-news", "default");
    expect(mockAudit).toHaveBeenCalledWith(
      expect.anything(),
      "media.delete",
      mediaSlug,
      { deleted: 1 },
    );
  });
});
