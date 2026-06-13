/**
 * Verifies that a successful admin mutation writes an audit row.
 *
 * Strategy:
 *  - Mock getAdminAccess() to return super access (same as cache-invalidation tests).
 *  - POST a game via the real route handler (real temp SQLite from setup.ts).
 *  - Assert listAdminAuditLog() contains a game.create row — proving the helper
 *    is wired and never breaks the route (route returns 200).
 */

import { describe, expect, test, vi } from "vitest";
import { superAdmin } from "./access";

vi.mock("@/lib/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin")>();
  return { ...actual, getAdminAccess: vi.fn() };
});

import { getAdminAccess } from "@/lib/admin";
const mockAccess = vi.mocked(getAdminAccess);

import { POST as gamesPOST } from "@/app/api/admin/games/route";

describe("audit trail: route mutations write audit rows", () => {
  test("POST /api/admin/games → game.create row written to audit log", async () => {
    mockAccess.mockResolvedValue(superAdmin());

    const slug = `audit-trail-game-${Date.now()}`;
    const body = {
      slug,
      title: { en: "Audit Test Game", ar: "لعبة اختبار التدقيق" },
      description: { en: "desc", ar: "وصف" },
      status: { en: "active", ar: "نشط" },
      owner: { en: "owner", ar: "مالك" },
      focus: [],
    };

    const res = await gamesPOST(
      new Request("http://localhost/api/admin/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

    // Route must succeed.
    expect(res.status).toBe(200);

    // Audit row must exist.
    const { listAdminAuditLog } = await import("@bot/db/ewcAdminAuditLog.js") as {
      listAdminAuditLog: (limit?: number, offset?: number) => Promise<{
        action: string;
        target: string | null;
        actorId: string;
      }[]>;
    };

    await new Promise((resolve) => setImmediate(resolve));
    const entries = await listAdminAuditLog();
    const row = entries.find((e) => e.action === "game.create" && e.target === slug);
    expect(row).toBeDefined();
    expect(row?.actorId).toBe(superAdmin().discordUserId);
  });
});
