/**
 * Verify that admin mutation routes call `revalidateTag` after successful writes.
 *
 * Strategy:
 *  - next/cache is aliased to our stub in vitest.config.ts — no static generation
 *    store needed.  We spy on the stub's revalidateTag export to assert calls.
 *  - Mock @/lib/admin (getAdminAccess) only.
 *  - Use a real temp SQLite DB (same setup as admin-authz.test.ts) so DB writes succeed.
 */

import * as nextCache from "next/cache";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { superAdmin } from "./access";

vi.mock("@/lib/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin")>();
  return { ...actual, getAdminAccess: vi.fn() };
});

import { getAdminAccess } from "@/lib/admin";

const mockAccess = vi.mocked(getAdminAccess);
const spyRevalidateTag = vi.spyOn(nextCache, "revalidateTag");

// ---------------------------------------------------------------------------
// Route imports (after mocks are registered)
// ---------------------------------------------------------------------------

import { POST as gamesPOST } from "@/app/api/admin/games/route";
import { PATCH as gamesSlugPATCH, DELETE as gamesSlugDELETE } from "@/app/api/admin/games/[slug]/route";
import { POST as gamesReorderPOST } from "@/app/api/admin/games/reorder/route";
import { POST as mediaPOST } from "@/app/api/admin/media/route";
import { PATCH as mediaSlugPATCH, DELETE as mediaSlugDELETE } from "@/app/api/admin/media/[slug]/route";
import { POST as mediaReorderPOST } from "@/app/api/admin/media/reorder/route";
import { POST as newsPOST } from "@/app/api/admin/news/route";
import { PATCH as newsIdPATCH, DELETE as newsIdDELETE } from "@/app/api/admin/news/[id]/route";
import { POST as newsIdStatusPOST } from "@/app/api/admin/news/[id]/status/route";
import { POST as partnersPOST } from "@/app/api/admin/partners/route";
import { PATCH as partnerIdPATCH, DELETE as partnerIdDELETE } from "@/app/api/admin/partners/[id]/route";
import { POST as campaignsPOST } from "@/app/api/admin/partners/campaigns/route";
import {
  PATCH as campaignIdPATCH,
  DELETE as campaignIdDELETE,
} from "@/app/api/admin/partners/campaigns/[id]/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function req(method = "POST", body?: unknown): Request {
  const headers: Record<string, string> = {
    Origin: "http://localhost",
    Host: "localhost",
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    return new Request("http://localhost/api/admin/test", {
      method,
      headers,
      body: JSON.stringify(body),
    });
  }
  return new Request("http://localhost/api/admin/test", { method, headers });
}

function ctx(params: Record<string, string>) {
  return { params: Promise.resolve(params) };
}

// ---------------------------------------------------------------------------
// DB seed helpers
// ---------------------------------------------------------------------------

async function seedGame(slug: string): Promise<void> {
  const { createEwcGame } = await import("@bot/db/ewcGames.js");
  try {
    await createEwcGame({
      slug,
      title: { en: slug, ar: slug },
      description: { en: "", ar: "" },
      status: { en: "", ar: "" },
      owner: { en: "", ar: "" },
      focus: [],
    });
  } catch {
    // already exists
  }
}

async function seedMediaChannel(slug: string): Promise<void> {
  const { createEwcMediaChannel } = await import("@bot/db/ewcMediaChannels.js");
  try {
    await createEwcMediaChannel({
      slug,
      name: { en: slug, ar: slug },
      description: { en: "", ar: "" },
      logoUrl: null,
      links: [],
    });
  } catch {
    // already exists
  }
}

async function seedNewsPost(gameSlug: string): Promise<number> {
  const { createEwcNewsPost } = await import("@bot/db/ewcNewsPosts.js");
  const post = await createEwcNewsPost({
    gameSlug,
    contentMode: "shared",
    defaultLocale: "en",
    translations: { en: { title: "Test", summary: "Test summary", body: "Test body" } },
    status: "draft",
    authorDiscordId: null,
    authorName: null,
    coverImageUrl: null,
  }) as { id: number };
  return post.id;
}

// ---------------------------------------------------------------------------
// Suite: revalidateTag is called on successful mutations
// ---------------------------------------------------------------------------

describe("admin mutation routes call revalidateTag on success", () => {
  beforeAll(() => {
    mockAccess.mockResolvedValue(superAdmin());
  });

  beforeEach(() => {
    spyRevalidateTag.mockClear();
  });

  // ---- Games ----------------------------------------------------------------

  test("POST /api/admin/games → revalidateTag(cms-games)", async () => {
    const gameSlug = `test-cache-game-${Date.now()}`;
    const body = {
      slug: gameSlug,
      title: { en: "Test Game", ar: "لعبة اختبار" },
      description: { en: "desc", ar: "وصف" },
      status: { en: "active", ar: "نشط" },
      owner: { en: "owner", ar: "مالك" },
      focus: [],
    };
    const res = await gamesPOST(req("POST", body));
    expect(res.status).toBe(200);
    expect(spyRevalidateTag).toHaveBeenCalledWith("cms-games", "default");
  });

  test("PATCH /api/admin/games/[slug] → revalidateTag(cms-games)", async () => {
    const slug = `patch-game-${Date.now()}`;
    await seedGame(slug);
    const body = {
      title: { en: "Updated", ar: "محدث" },
      description: { en: "d", ar: "و" },
      status: { en: "s", ar: "س" },
      owner: { en: "o", ar: "م" },
      focus: [],
    };
    const res = await gamesSlugPATCH(req("PATCH", body), ctx({ slug }));
    expect(res.status).toBe(200);
    expect(spyRevalidateTag).toHaveBeenCalledWith("cms-games", "default");
  });

  test("DELETE /api/admin/games/[slug] → revalidateTag(cms-games) + revalidateTag(cms-news)", async () => {
    const slug = `del-game-${Date.now()}`;
    await seedGame(slug);
    const res = await gamesSlugDELETE(req("DELETE"), ctx({ slug }));
    expect(res.status).toBe(200);
    expect(spyRevalidateTag).toHaveBeenCalledWith("cms-games", "default");
    expect(spyRevalidateTag).toHaveBeenCalledWith("cms-news", "default");
  });

  test("POST /api/admin/games/reorder → revalidateTag(cms-games)", async () => {
    // Reorder requires ALL existing slugs exactly once.
    // Read every current slug, add our new one, reorder the full set.
    const { listEwcGames } = await import("@bot/db/ewcGames.js") as {
      listEwcGames: () => Promise<{ slug: string }[]>;
    };
    const slug = `reorder-game-${Date.now()}`;
    await seedGame(slug);
    const allSlugs = (await listEwcGames()).map((g) => g.slug);
    const res = await gamesReorderPOST(req("POST", { slugs: allSlugs }));
    expect(res.status).toBe(200);
    expect(spyRevalidateTag).toHaveBeenCalledWith("cms-games", "default");
  });

  // ---- Media ----------------------------------------------------------------

  test("POST /api/admin/media → revalidateTag(cms-media)", async () => {
    const slug = `test-cache-media-${Date.now()}`;
    const body = {
      slug,
      name: { en: "Chan", ar: "قناة" },
      description: { en: "d", ar: "و" },
      logoUrl: null,
      links: [],
    };
    const res = await mediaPOST(req("POST", body));
    expect(res.status).toBe(200);
    expect(spyRevalidateTag).toHaveBeenCalledWith("cms-media", "default");
  });

  test("PATCH /api/admin/media/[slug] → revalidateTag(cms-media)", async () => {
    const slug = `patch-media-${Date.now()}`;
    await seedMediaChannel(slug);
    const body = {
      name: { en: "Updated", ar: "محدث" },
      description: { en: "d", ar: "و" },
      logoUrl: null,
      links: [],
    };
    const res = await mediaSlugPATCH(req("PATCH", body), ctx({ slug }));
    expect(res.status).toBe(200);
    expect(spyRevalidateTag).toHaveBeenCalledWith("cms-media", "default");
  });

  test("DELETE /api/admin/media/[slug] → revalidateTag(cms-media)", async () => {
    const slug = `del-media-${Date.now()}`;
    await seedMediaChannel(slug);
    const res = await mediaSlugDELETE(req("DELETE"), ctx({ slug }));
    expect(res.status).toBe(200);
    expect(spyRevalidateTag).toHaveBeenCalledWith("cms-media", "default");
  });

  test("POST /api/admin/media/reorder → revalidateTag(cms-media)", async () => {
    // Reorder requires ALL existing slugs exactly once.
    const { listEwcMediaChannels } = await import("@bot/db/ewcMediaChannels.js") as {
      listEwcMediaChannels: () => Promise<{ slug: string }[]>;
    };
    const slug = `reorder-media-${Date.now()}`;
    await seedMediaChannel(slug);
    const allSlugs = (await listEwcMediaChannels()).map((c) => c.slug);
    const res = await mediaReorderPOST(req("POST", { slugs: allSlugs }));
    expect(res.status).toBe(200);
    expect(spyRevalidateTag).toHaveBeenCalledWith("cms-media", "default");
  });

  // ---- News -----------------------------------------------------------------

  test("POST /api/admin/news → revalidateTag(cms-news)", async () => {
    const gameSlug = `news-create-game-${Date.now()}`;
    await seedGame(gameSlug);
    const body = {
      gameSlug,
      contentMode: "shared",
      defaultLocale: "en",
      translations: { en: { title: "Title", summary: "Sum", body: "Body" } },
    };
    const res = await newsPOST(req("POST", body));
    expect(res.status).toBe(200);
    expect(spyRevalidateTag).toHaveBeenCalledWith("cms-news", { expire: 0 });
  });

  test("PATCH /api/admin/news/[id] → revalidateTag(cms-news)", async () => {
    const gameSlug = `news-patch-game-${Date.now()}`;
    await seedGame(gameSlug);
    const postId = await seedNewsPost(gameSlug);
    const body = {
      gameSlug,
      contentMode: "shared",
      defaultLocale: "en",
      translations: { en: { title: "Updated", summary: "Sum", body: "Body" } },
    };
    const res = await newsIdPATCH(req("PATCH", body), ctx({ id: String(postId) }));
    expect(res.status).toBe(200);
    expect(spyRevalidateTag).toHaveBeenCalledWith("cms-news", { expire: 0 });
  });

  test("DELETE /api/admin/news/[id] → revalidateTag(cms-news)", async () => {
    const gameSlug = `news-del-game-${Date.now()}`;
    await seedGame(gameSlug);
    const postId = await seedNewsPost(gameSlug);
    const res = await newsIdDELETE(req("DELETE"), ctx({ id: String(postId) }));
    expect(res.status).toBe(200);
    expect(spyRevalidateTag).toHaveBeenCalledWith("cms-news", { expire: 0 });
  });

  test("POST /api/admin/news/[id]/status → revalidateTag(cms-news)", async () => {
    const gameSlug = `news-status-game-${Date.now()}`;
    await seedGame(gameSlug);
    const postId = await seedNewsPost(gameSlug);
    const res = await newsIdStatusPOST(req("POST", { status: "published" }), ctx({ id: String(postId) }));
    expect(res.status).toBe(200);
    expect(spyRevalidateTag).toHaveBeenCalledWith("cms-news", { expire: 0 });
  });

  // ---- Partners -------------------------------------------------------------

  async function seedPartner(): Promise<{ id: number; slug: string }> {
    const { createPartner } = await import("@bot/db/partners.js");
    const slug = `cache-partner-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    return (await createPartner({ slug, name: "Cache Partner" })) as { id: number; slug: string };
  }

  test("POST /api/admin/partners → revalidateTag(cms-partners)", async () => {
    const slug = `cache-partner-post-${Date.now()}`;
    const res = await partnersPOST(req("POST", { slug, name: "Cache Partner" }));
    expect(res.status).toBe(200);
    expect(spyRevalidateTag).toHaveBeenCalledWith("cms-partners", "default");
  });

  test("PATCH /api/admin/partners/[id] → revalidateTag(cms-partners)", async () => {
    const partner = await seedPartner();
    // The route validates the full partner shape, so slug + name are required.
    const res = await partnerIdPATCH(
      req("PATCH", { slug: partner.slug, name: "Renamed" }),
      ctx({ id: String(partner.id) }),
    );
    expect(res.status).toBe(200);
    expect(spyRevalidateTag).toHaveBeenCalledWith("cms-partners", "default");
  });

  test("DELETE /api/admin/partners/[id] → revalidateTag(cms-partners)", async () => {
    const partner = await seedPartner();
    const res = await partnerIdDELETE(req("DELETE"), ctx({ id: String(partner.id) }));
    expect(res.status).toBe(200);
    expect(spyRevalidateTag).toHaveBeenCalledWith("cms-partners", "default");
  });

  async function seedCampaign(): Promise<{ id: number }> {
    const partner = await seedPartner();
    const { createPartnerCampaign } = await import("@bot/db/partners.js");
    return (await createPartnerCampaign({ partnerId: partner.id, kind: "footer" })) as { id: number };
  }

  test("POST /api/admin/partners/campaigns → revalidateTag(cms-partners)", async () => {
    const partner = await seedPartner();
    const res = await campaignsPOST(req("POST", { partnerId: partner.id, kind: "footer" }));
    expect(res.status).toBe(200);
    expect(spyRevalidateTag).toHaveBeenCalledWith("cms-partners", "default");
  });

  test("PATCH /api/admin/partners/campaigns/[id] → revalidateTag(cms-partners)", async () => {
    const campaign = await seedCampaign();
    const partner = await seedPartner();
    const res = await campaignIdPATCH(
      req("PATCH", { partnerId: partner.id, kind: "homepage" }),
      ctx({ id: String(campaign.id) }),
    );
    expect(res.status).toBe(200);
    expect(spyRevalidateTag).toHaveBeenCalledWith("cms-partners", "default");
  });

  test("DELETE /api/admin/partners/campaigns/[id] → revalidateTag(cms-partners)", async () => {
    const campaign = await seedCampaign();
    const res = await campaignIdDELETE(req("DELETE"), ctx({ id: String(campaign.id) }));
    expect(res.status).toBe(200);
    expect(spyRevalidateTag).toHaveBeenCalledWith("cms-partners", "default");
  });
});
