/**
 * Authorization matrix for /api/admin/* route handlers.
 *
 * Strategy:
 *  - Mock only getAdminAccess() — keep isSuper / canManageGame / canManageMedia REAL
 *    (they are pure functions and mocking them would test the mock, not the routes).
 *  - Seed real DB rows for the scope-crossing cases so we test the actual DB+route path.
 *  - Status codes only; body error string checked only where it distinguishes 403 variants.
 */

import { beforeAll, describe, expect, test, vi } from "vitest";
import {
  anonymous,
  gamesAdmin,
  mediaAdmin,
  nonAdmin,
  superAdmin,
} from "./access";

vi.mock("@/lib/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin")>();
  return { ...actual, getAdminAccess: vi.fn() };
});

// Import the mock AFTER vi.mock is set up so TypeScript is happy.
import { getAdminAccess } from "@/lib/admin";
const mockAccess = vi.mocked(getAdminAccess);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function req(method = "GET", body?: unknown): Request {
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

function authorsReq(game: string): Request {
  return new Request(`http://localhost/api/admin/authors?game=${encodeURIComponent(game)}`, {
    method: "GET",
  });
}

// ---------------------------------------------------------------------------
// DB seed helpers (real bot DB modules, temp SQLite file via setup.ts)
// ---------------------------------------------------------------------------

async function seedGame(slug: string): Promise<void> {
  const { createEwcGame } = await import("@bot/db/ewcGames.js");
  // Ignore duplicate errors if already seeded.
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
// Route imports (after mocks are registered)
// ---------------------------------------------------------------------------

import { GET as gamesGET, POST as gamesPOST } from "@/app/api/admin/games/route";
import { PATCH as gamesSlugPATCH, DELETE as gamesSlugDELETE } from "@/app/api/admin/games/[slug]/route";
import { POST as gamesReorderPOST } from "@/app/api/admin/games/reorder/route";
import { GET as mediaGET, POST as mediaPOST } from "@/app/api/admin/media/route";
import { PATCH as mediaSlugPATCH, DELETE as mediaSlugDELETE } from "@/app/api/admin/media/[slug]/route";
import { POST as mediaReorderPOST } from "@/app/api/admin/media/reorder/route";
import { GET as newsGET, POST as newsPOST } from "@/app/api/admin/news/route";
import { PATCH as newsIdPATCH, DELETE as newsIdDELETE } from "@/app/api/admin/news/[id]/route";
import { POST as newsIdStatusPOST } from "@/app/api/admin/news/[id]/status/route";
import { POST as newsUploadPOST } from "@/app/api/admin/news/upload/route";
import { GET as teamGET, POST as teamPOST } from "@/app/api/admin/team/route";
import { PATCH as teamIdPATCH, DELETE as teamIdDELETE } from "@/app/api/admin/team/[discordId]/route";
import { GET as authorsGET } from "@/app/api/admin/authors/route";
import {
  POST as userBlockPOST,
  DELETE as userBlockDELETE,
} from "@/app/api/admin/users/[discordId]/block/route";

// ---------------------------------------------------------------------------
// Suite 0: CSRF same-origin guard
// ---------------------------------------------------------------------------

describe("admin mutation CSRF guard", () => {
  test("cross-origin mutation is rejected before auth", async () => {
    mockAccess.mockClear();
    const res = await gamesPOST(
      new Request("http://localhost/api/admin/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.example",
          Host: "localhost",
        },
        body: "{}",
      }),
    );
    expect(res.status).toBe(403);
    expect(mockAccess).not.toHaveBeenCalled();
  });

  test("missing Origin is rejected", async () => {
    mockAccess.mockClear();
    const res = await gamesPOST(
      new Request("http://localhost/api/admin/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Host: "localhost",
        },
        body: "{}",
      }),
    );
    expect(res.status).toBe(403);
    expect(mockAccess).not.toHaveBeenCalled();
  });

  test("same-origin mutation falls through to auth", async () => {
    mockAccess.mockResolvedValue(anonymous());
    mockAccess.mockClear();
    const res = await gamesPOST(req("POST", {}));
    expect(res.status).toBe(401);
    expect(mockAccess).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Suite 1: Anonymous → 401 on every handler
// ---------------------------------------------------------------------------

describe("anonymous → 401 on all handlers", () => {
  beforeAll(() => {
    mockAccess.mockResolvedValue(anonymous());
  });

  const SNOWFLAKE = "123456789012345678";

  const cases: Array<[string, () => Promise<Response>]> = [
    ["games GET", () => gamesGET()],
    ["games POST", () => gamesPOST(req("POST", {}))],
    ["games/[slug] PATCH", () => gamesSlugPATCH(req("PATCH", {}), ctx({ slug: "valorant" }))],
    ["games/[slug] DELETE", () => gamesSlugDELETE(req("DELETE"), ctx({ slug: "valorant" }))],
    ["games/reorder POST", () => gamesReorderPOST(req("POST", { slugs: ["x"] }))],
    ["media GET", () => mediaGET()],
    ["media POST", () => mediaPOST(req("POST", {}))],
    ["media/[slug] PATCH", () => mediaSlugPATCH(req("PATCH", {}), ctx({ slug: "youtube" }))],
    ["media/[slug] DELETE", () => mediaSlugDELETE(req("DELETE"), ctx({ slug: "youtube" }))],
    ["media/reorder POST", () => mediaReorderPOST(req("POST", { slugs: ["x"] }))],
    ["news GET", () => newsGET(req("GET"))],
    ["news POST", () => newsPOST(req("POST", {}))],
    ["news/[id] PATCH", () => newsIdPATCH(req("PATCH", {}), ctx({ id: "1" }))],
    ["news/[id] DELETE", () => newsIdDELETE(req("DELETE"), ctx({ id: "1" }))],
    ["news/[id]/status POST", () => newsIdStatusPOST(req("POST", { status: "published" }), ctx({ id: "1" }))],
    ["news/upload POST", () => newsUploadPOST(req("POST"))],
    ["team GET", () => teamGET()],
    ["team POST", () => teamPOST(req("POST", { discordId: SNOWFLAKE }))],
    ["team/[discordId] PATCH", () => teamIdPATCH(req("PATCH", {}), ctx({ discordId: SNOWFLAKE }))],
    ["team/[discordId] DELETE", () => teamIdDELETE(req("DELETE"), ctx({ discordId: SNOWFLAKE }))],
    ["authors GET", () => authorsGET(authorsReq("valorant"))],
  ];

  for (const [name, invoke] of cases) {
    test(`${name} → 401`, async () => {
      const res = await invoke();
      expect(res.status, name).toBe(401);
    });
  }
});

// ---------------------------------------------------------------------------
// Suite 2: Authenticated non-admin (allowed: false) → 403 on every handler
// ---------------------------------------------------------------------------

describe("non-admin (authenticated, allowed=false) → 403 on all handlers", () => {
  beforeAll(() => {
    mockAccess.mockResolvedValue(nonAdmin());
  });

  const SNOWFLAKE = "123456789012345678";

  const cases: Array<[string, () => Promise<Response>]> = [
    ["games GET", () => gamesGET()],
    ["games POST", () => gamesPOST(req("POST", {}))],
    ["games/[slug] PATCH", () => gamesSlugPATCH(req("PATCH", {}), ctx({ slug: "valorant" }))],
    ["games/[slug] DELETE", () => gamesSlugDELETE(req("DELETE"), ctx({ slug: "valorant" }))],
    ["games/reorder POST", () => gamesReorderPOST(req("POST", { slugs: ["x"] }))],
    ["media GET", () => mediaGET()],
    ["media POST", () => mediaPOST(req("POST", {}))],
    ["media/[slug] PATCH", () => mediaSlugPATCH(req("PATCH", {}), ctx({ slug: "youtube" }))],
    ["media/[slug] DELETE", () => mediaSlugDELETE(req("DELETE"), ctx({ slug: "youtube" }))],
    ["media/reorder POST", () => mediaReorderPOST(req("POST", { slugs: ["x"] }))],
    ["news GET", () => newsGET(req("GET"))],
    ["news POST", () => newsPOST(req("POST", {}))],
    ["news/[id] PATCH", () => newsIdPATCH(req("PATCH", {}), ctx({ id: "1" }))],
    ["news/[id] DELETE", () => newsIdDELETE(req("DELETE"), ctx({ id: "1" }))],
    ["news/[id]/status POST", () => newsIdStatusPOST(req("POST", { status: "published" }), ctx({ id: "1" }))],
    ["news/upload POST", () => newsUploadPOST(req("POST"))],
    ["team GET", () => teamGET()],
    ["team POST", () => teamPOST(req("POST", { discordId: SNOWFLAKE }))],
    ["team/[discordId] PATCH", () => teamIdPATCH(req("PATCH", {}), ctx({ discordId: SNOWFLAKE }))],
    ["team/[discordId] DELETE", () => teamIdDELETE(req("DELETE"), ctx({ discordId: SNOWFLAKE }))],
    ["authors GET", () => authorsGET(authorsReq("valorant"))],
  ];

  for (const [name, invoke] of cases) {
    test(`${name} → 403`, async () => {
      const res = await invoke();
      expect(res.status, name).toBe(403);
    });
  }
});

// ---------------------------------------------------------------------------
// Suite 3: Super-only writes — gamesAdmin → 403
// ---------------------------------------------------------------------------

describe("super-only endpoints → 403 for scoped games admin", () => {
  beforeAll(() => {
    mockAccess.mockResolvedValue(gamesAdmin(["valorant"]));
  });

  const SNOWFLAKE = "123456789012345678";

  test("games POST → 403", async () => {
    const res = await gamesPOST(req("POST", { slug: "test", title: { en: "T", ar: "T" } }));
    expect(res.status).toBe(403);
  });

  test("games/[slug] DELETE → 403", async () => {
    const res = await gamesSlugDELETE(req("DELETE"), ctx({ slug: "valorant" }));
    expect(res.status).toBe(403);
  });

  test("games/reorder POST → 403", async () => {
    const res = await gamesReorderPOST(req("POST", { slugs: ["valorant"] }));
    expect(res.status).toBe(403);
  });

  test("media POST → 403", async () => {
    const res = await mediaPOST(req("POST", { slug: "ch", name: { en: "N", ar: "N" } }));
    expect(res.status).toBe(403);
  });

  test("media/[slug] DELETE → 403", async () => {
    const res = await mediaSlugDELETE(req("DELETE"), ctx({ slug: "youtube" }));
    expect(res.status).toBe(403);
  });

  test("media/reorder POST → 403", async () => {
    const res = await mediaReorderPOST(req("POST", { slugs: ["youtube"] }));
    expect(res.status).toBe(403);
  });

  test("team GET → 403", async () => {
    const res = await teamGET();
    expect(res.status).toBe(403);
  });

  test("team POST → 403", async () => {
    const res = await teamPOST(req("POST", { discordId: SNOWFLAKE }));
    expect(res.status).toBe(403);
  });

  test("team/[discordId] PATCH → 403", async () => {
    const res = await teamIdPATCH(req("PATCH", {}), ctx({ discordId: SNOWFLAKE }));
    expect(res.status).toBe(403);
  });

  test("team/[discordId] DELETE → 403", async () => {
    const res = await teamIdDELETE(req("DELETE"), ctx({ discordId: SNOWFLAKE }));
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Suite 4: Scope crossing on news — real DB seeded post
// ---------------------------------------------------------------------------

describe("news scope-crossing (real DB seed)", () => {
  let postId: number;
  const POST_GAME = "test-scope-game";
  const OTHER_GAME = "other-scope-game";

  beforeAll(async () => {
    await seedGame(POST_GAME);
    postId = await seedNewsPost(POST_GAME);
  });

  // news/[id]/status POST
  test("status POST: wrong game → 403 with 'not assigned'", async () => {
    mockAccess.mockResolvedValue(gamesAdmin([OTHER_GAME]));
    const res = await newsIdStatusPOST(
      req("POST", { status: "draft" }),
      ctx({ id: String(postId) }),
    );
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/not assigned/i);
  });

  test("status POST: correct game → 200", async () => {
    mockAccess.mockResolvedValue(gamesAdmin([POST_GAME]));
    const res = await newsIdStatusPOST(
      req("POST", { status: "draft" }),
      ctx({ id: String(postId) }),
    );
    expect(res.status).toBe(200);
  });

  // news/[id] PATCH scope check
  test("news PATCH: wrong game → 403 with 'not assigned'", async () => {
    mockAccess.mockResolvedValue(gamesAdmin([OTHER_GAME]));
    const body = {
      gameSlug: POST_GAME,
      contentMode: "shared",
      defaultLocale: "en",
      translations: { en: { title: "T", summary: "S", body: "B" } },
    };
    const res = await newsIdPATCH(req("PATCH", body), ctx({ id: String(postId) }));
    expect(res.status).toBe(403);
    const resBody = await res.json() as { error: string };
    expect(resBody.error).toMatch(/not assigned/i);
  });

  test("news PATCH: correct game → 200", async () => {
    mockAccess.mockResolvedValue(gamesAdmin([POST_GAME]));
    const body = {
      gameSlug: POST_GAME,
      contentMode: "shared",
      defaultLocale: "en",
      translations: { en: { title: "T", summary: "S", body: "B" } },
    };
    const res = await newsIdPATCH(req("PATCH", body), ctx({ id: String(postId) }));
    expect(res.status).toBe(200);
  });

  // news/[id] DELETE scope check
  test("news DELETE: wrong game → 403 with 'not assigned'", async () => {
    mockAccess.mockResolvedValue(gamesAdmin([OTHER_GAME]));
    const res = await newsIdDELETE(req("DELETE"), ctx({ id: String(postId) }));
    expect(res.status).toBe(403);
    const resBody = await res.json() as { error: string };
    expect(resBody.error).toMatch(/not assigned/i);
  });

  test("news DELETE: correct game → 200", async () => {
    mockAccess.mockResolvedValue(gamesAdmin([POST_GAME]));
    const res = await newsIdDELETE(req("DELETE"), ctx({ id: String(postId) }));
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Suite 5: news POST scope check (canManageGame on create)
// ---------------------------------------------------------------------------

describe("news POST scope check", () => {
  beforeAll(async () => {
    await seedGame("create-game");
  });

  test("news POST: gamesAdmin for wrong game → 403", async () => {
    mockAccess.mockResolvedValue(gamesAdmin(["other-game-xyz"]));
    const body = {
      gameSlug: "create-game",
      contentMode: "shared",
      defaultLocale: "en",
      translations: { en: { title: "T", summary: "S", body: "B" } },
    };
    const res = await newsPOST(req("POST", body));
    expect(res.status).toBe(403);
  });

  test("news POST: gamesAdmin for correct game → 200", async () => {
    mockAccess.mockResolvedValue(gamesAdmin(["create-game"]));
    const body = {
      gameSlug: "create-game",
      contentMode: "shared",
      defaultLocale: "en",
      translations: { en: { title: "T", summary: "S", body: "B" } },
    };
    const res = await newsPOST(req("POST", body));
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Suite 6: games/[slug] PATCH — gamesAdmin scope check
// ---------------------------------------------------------------------------

describe("games/[slug] PATCH scope check", () => {
  beforeAll(async () => {
    await seedGame("scope-patch-game");
  });

  test("gamesAdmin for different game → 403", async () => {
    mockAccess.mockResolvedValue(gamesAdmin(["other-game"]));
    const res = await gamesSlugPATCH(
      req("PATCH", { title: { en: "T", ar: "T" }, description: { en: "", ar: "" }, status: { en: "", ar: "" }, owner: { en: "", ar: "" }, focus: [] }),
      ctx({ slug: "scope-patch-game" }),
    );
    expect(res.status).toBe(403);
  });

  test("gamesAdmin for correct game → 200", async () => {
    mockAccess.mockResolvedValue(gamesAdmin(["scope-patch-game"]));
    const res = await gamesSlugPATCH(
      req("PATCH", { title: { en: "T", ar: "T" }, description: { en: "", ar: "" }, status: { en: "", ar: "" }, owner: { en: "", ar: "" }, focus: [] }),
      ctx({ slug: "scope-patch-game" }),
    );
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Suite 7a: media/[slug] PATCH scope check
// ---------------------------------------------------------------------------

describe("media/[slug] PATCH scope check", () => {
  async function seedMediaChannel(slug: string): Promise<void> {
    const { createEwcMediaChannel } = await import("@bot/db/ewcMediaChannels.js");
    try {
      (createEwcMediaChannel as (input: unknown) => unknown)({
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

  beforeAll(async () => {
    await seedMediaChannel("scope-media-channel");
  });

  test("mediaAdmin for different channel → 403", async () => {
    mockAccess.mockResolvedValue(mediaAdmin(["other-channel"]));
    const res = await mediaSlugPATCH(
      req("PATCH", { name: { en: "N", ar: "N" }, description: { en: "", ar: "" }, links: [] }),
      ctx({ slug: "scope-media-channel" }),
    );
    expect(res.status).toBe(403);
  });

  test("mediaAdmin for correct channel → 200", async () => {
    mockAccess.mockResolvedValue(mediaAdmin(["scope-media-channel"]));
    const res = await mediaSlugPATCH(
      req("PATCH", { name: { en: "N", ar: "N" }, description: { en: "", ar: "" }, links: [] }),
      ctx({ slug: "scope-media-channel" }),
    );
    expect(res.status).toBe(200);
  });

  test("superAdmin for any channel → 200", async () => {
    mockAccess.mockResolvedValue(superAdmin());
    const res = await mediaSlugPATCH(
      req("PATCH", { name: { en: "N", ar: "N" }, description: { en: "", ar: "" }, links: [] }),
      ctx({ slug: "scope-media-channel" }),
    );
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Suite 8: authors picker scope check (canManageGame)
// ---------------------------------------------------------------------------

describe("authors picker scope check", () => {
  beforeAll(async () => {
    await seedGame("authors-scope-game");
  });

  test("gamesAdmin for wrong game → 403", async () => {
    mockAccess.mockResolvedValue(gamesAdmin(["other-game"]));
    const res = await authorsGET(authorsReq("authors-scope-game"));
    expect(res.status).toBe(403);
  });

  test("gamesAdmin for correct game → 200", async () => {
    mockAccess.mockResolvedValue(gamesAdmin(["authors-scope-game"]));
    const res = await authorsGET(authorsReq("authors-scope-game"));
    expect(res.status).toBe(200);
  });

  test("superAdmin → 200", async () => {
    mockAccess.mockResolvedValue(superAdmin());
    const res = await authorsGET(authorsReq("authors-scope-game"));
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Suite 9: news/upload — anonymous → 401, non-admin → 403, admin no R2 → 503
// ---------------------------------------------------------------------------

describe("news/upload authorization", () => {
  test("anonymous → 401", async () => {
    mockAccess.mockResolvedValue(anonymous());
    const res = await newsUploadPOST(req("POST"));
    expect(res.status).toBe(401);
  });

  test("non-admin → 403", async () => {
    mockAccess.mockResolvedValue(nonAdmin());
    const res = await newsUploadPOST(req("POST"));
    expect(res.status).toBe(403);
  });

  test("gamesAdmin, R2 not configured → 503", async () => {
    // Ensure R2 env vars are NOT set (they shouldn't be in test env).
    const savedVars = {
      R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
      R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
      R2_BUCKET: process.env.R2_BUCKET,
      R2_PUBLIC_BASE_URL: process.env.R2_PUBLIC_BASE_URL,
    };
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_BUCKET;
    delete process.env.R2_PUBLIC_BASE_URL;

    mockAccess.mockResolvedValue(gamesAdmin(["some-game"]));
    const res = await newsUploadPOST(req("POST"));
    expect(res.status).toBe(503);

    // Restore.
    for (const [k, v] of Object.entries(savedVars)) {
      if (v !== undefined) process.env[k] = v;
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 10: news author eligibility on write (031) — submitted authors must be
// eligible for the target game; the stored name comes from the roster, not the
// payload (no attribution spoofing).
// ---------------------------------------------------------------------------

describe("news author eligibility on write", () => {
  const GAME = "author-write-game";
  const ELIGIBLE = "111111111111111111";
  const INELIGIBLE = "999999999999999999";
  let postId: number;

  beforeAll(async () => {
    await seedGame(GAME);
    const { upsertEwcAdmin, setEwcAdminGameScopes } = await import("@bot/db/ewcAdmins.js");
    await (upsertEwcAdmin as (i: unknown) => Promise<unknown>)({
      discordId: ELIGIBLE,
      displayName: "Roster Author",
    });
    await (setEwcAdminGameScopes as (id: string, games: string[]) => Promise<unknown>)(
      ELIGIBLE,
      [GAME],
    );
    postId = await seedNewsPost(GAME);
  });

  function newsBody(authors?: Array<{ discordId: string; name: string }>) {
    return {
      gameSlug: GAME,
      contentMode: "shared",
      defaultLocale: "en",
      translations: { en: { title: "T", summary: "S", body: "B" } },
      ...(authors ? { authors } : {}),
    };
  }

  test("POST: submitting an ineligible author → 403", async () => {
    mockAccess.mockResolvedValue(gamesAdmin([GAME]));
    const res = await newsPOST(req("POST", newsBody([{ discordId: INELIGIBLE, name: "Spoofed" }])));
    expect(res.status).toBe(403);
  });

  test("POST: eligible roster author → 200 with canonical name (payload name ignored)", async () => {
    mockAccess.mockResolvedValue(gamesAdmin([GAME]));
    const res = await newsPOST(req("POST", newsBody([{ discordId: ELIGIBLE, name: "Spoofed name" }])));
    expect(res.status).toBe(200);
    const post = (await res.json()) as { authors: Array<{ discordId: string; name: string }> };
    expect(post.authors[0].discordId).toBe(ELIGIBLE);
    expect(post.authors[0].name).toBe("Roster Author");
  });

  test("PATCH: submitting an ineligible author → 403", async () => {
    mockAccess.mockResolvedValue(gamesAdmin([GAME]));
    const res = await newsIdPATCH(
      req("PATCH", newsBody([{ discordId: INELIGIBLE, name: "Spoofed" }])),
      ctx({ id: String(postId) }),
    );
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Suite 11: Users area block/unblock route — SUPER ONLY (054)
// superAdmin().discordUserId is 123456789012345678; a DIFFERENT target snowflake
// is used for the happy path so the self-block guard does not interfere.
// ---------------------------------------------------------------------------

describe("users block route authorization (super-only)", () => {
  const TARGET = "222222222222222222"; // != superAdmin().discordUserId

  test("anonymous → 401", async () => {
    mockAccess.mockResolvedValue(anonymous());
    const res = await userBlockPOST(req("POST", {}), ctx({ discordId: TARGET }));
    expect(res.status).toBe(401);
  });

  test("scoped (non-super) games admin → 403", async () => {
    mockAccess.mockResolvedValue(gamesAdmin(["valorant"]));
    const res = await userBlockPOST(req("POST", {}), ctx({ discordId: TARGET }));
    expect(res.status).toBe(403);
  });

  test("non-admin → 403", async () => {
    mockAccess.mockResolvedValue(nonAdmin());
    const res = await userBlockPOST(req("POST", {}), ctx({ discordId: TARGET }));
    expect(res.status).toBe(403);
  });

  test("super POST then DELETE → 200", async () => {
    mockAccess.mockResolvedValue(superAdmin());
    const blockRes = await userBlockPOST(req("POST", { reason: "spam" }), ctx({ discordId: TARGET }));
    expect(blockRes.status).toBe(200);
    expect((await blockRes.json()).blocked).toBe(true);

    const unblockRes = await userBlockDELETE(req("DELETE"), ctx({ discordId: TARGET }));
    expect(unblockRes.status).toBe(200);
    expect((await unblockRes.json()).blocked).toBe(false);
  });

  test("super blocking themselves → 400", async () => {
    mockAccess.mockResolvedValue(superAdmin());
    const res = await userBlockPOST(req("POST", {}), ctx({ discordId: "123456789012345678" }));
    expect(res.status).toBe(400);
  });
});
