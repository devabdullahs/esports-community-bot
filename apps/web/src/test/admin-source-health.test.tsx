import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { anonymous, gamesAdmin, superAdmin } from "./access";

vi.mock("@/lib/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin")>();
  return { ...actual, getAdminAccess: vi.fn() };
});
vi.mock("@/lib/request-locale", () => ({ getRequestLocale: async () => "en" }));
vi.mock("@/components/admin/admin-page-shell", () => ({
  AdminPageShell: ({ title, children }: { title: string; children: ReactNode }) => (
    <main><h1>{title}</h1>{children}</main>
  ),
}));

import AdminSourceHealthPage from "@/app/admin/source-health/page";
import { getAdminAccess } from "@/lib/admin";

const mockAccess = vi.mocked(getAdminAccess);

beforeAll(async () => {
  await import("@bot/db/index.js");
  const { addTournament } = await import("@bot/db/tournaments.js");
  const { recordTournamentSyncFailure } = await import("@bot/db/tournamentSyncHealth.js");
  const tournament = await addTournament({
    source: "liquipedia",
    external_id: `admin-source-health-${Date.now()}`,
    game: "valorant",
    name: "Admin health fixture",
    url: "https://liquipedia.net/valorant/Admin_Health_Fixture",
    guild_id: "admin-source-health-guild",
  });
  await recordTournamentSyncFailure({
    tournamentId: tournament.id,
    source: "liquipedia",
    category: "parse",
    at: Math.floor(Date.now() / 1000),
  });
});

function page() {
  return AdminSourceHealthPage({ searchParams: Promise.resolve({}) });
}

describe("/admin/source-health", () => {
  test("redirects signed-out visitors", async () => {
    mockAccess.mockResolvedValue(anonymous());
    await expect(page()).rejects.toMatchObject({ digest: expect.stringMatching(/NEXT_REDIRECT/) });
  });

  test("redirects scoped admins", async () => {
    mockAccess.mockResolvedValue(gamesAdmin(["valorant"]));
    await expect(page()).rejects.toMatchObject({ digest: expect.stringMatching(/NEXT_REDIRECT/) });
  });

  test("renders a super-admin-only sanitized operations table", async () => {
    mockAccess.mockResolvedValue(superAdmin());
    const html = renderToStaticMarkup(await page());
    expect(html).toContain("Tournament source health");
    expect(html).toContain("Admin health fixture");
    expect(html).toContain("Parse");
    expect(html).not.toMatch(/private upstream response|credential|responseBody|stack trace/i);
  });
});
