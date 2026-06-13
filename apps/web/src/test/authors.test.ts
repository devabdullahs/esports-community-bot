/**
 * Unit tests for the season default and the eligible-author resolver.
 *
 * Uses the real per-run temp SQLite DB (setup.ts). Roster admins are seeded via
 * the bot's @bot/db/ewcAdmins helpers; env supers are set on process.env.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { currentSeason } from "@/lib/env";
import { listEligibleAuthors } from "@/lib/authors";
import {
  deleteEwcAdmin,
  upsertEwcAdmin,
  setEwcAdminGameScopes,
} from "@bot/db/ewcAdmins.js";

describe("currentSeason", () => {
  test("returns the current four-digit year", () => {
    expect(currentSeason()).toBe(String(new Date().getFullYear()));
  });
});

describe("listEligibleAuthors", () => {
  // Snowflakes for two roster admins.
  const ADMIN_A = "200000000000000001"; // displayName "Aaron", scoped to valorant
  const ADMIN_Z = "200000000000000002"; // displayName "Zed", scoped to valorant
  const ADMIN_OTHER = "200000000000000003"; // scoped to a different game
  const SUPER_ID = "900000000000000001";
  const savedSuper = process.env.EWC_DASHBOARD_SUPER_ADMIN_DISCORD_IDS;
  const savedLegacy = process.env.EWC_DASHBOARD_ADMIN_DISCORD_IDS;

  beforeEach(() => {
    process.env.EWC_DASHBOARD_SUPER_ADMIN_DISCORD_IDS = SUPER_ID;
    process.env.EWC_DASHBOARD_ADMIN_DISCORD_IDS = "";
    upsertEwcAdmin({ discordId: ADMIN_Z, displayName: "Zed" });
    setEwcAdminGameScopes(ADMIN_Z, ["valorant"]);
    upsertEwcAdmin({ discordId: ADMIN_A, displayName: "Aaron" });
    setEwcAdminGameScopes(ADMIN_A, ["valorant"]);
    upsertEwcAdmin({ discordId: ADMIN_OTHER, displayName: "Other" });
    setEwcAdminGameScopes(ADMIN_OTHER, ["cs2"]);
  });

  afterEach(() => {
    process.env.EWC_DASHBOARD_SUPER_ADMIN_DISCORD_IDS = savedSuper;
    process.env.EWC_DASHBOARD_ADMIN_DISCORD_IDS = savedLegacy;
    deleteEwcAdmin(ADMIN_A);
    deleteEwcAdmin(ADMIN_Z);
    deleteEwcAdmin(ADMIN_OTHER);
  });

  test("includes the env super and game-scoped roster admins only", () => {
    const ids = listEligibleAuthors("valorant").map((a) => a.discordId);
    expect(ids).toContain(SUPER_ID);
    expect(ids).toContain(ADMIN_A);
    expect(ids).toContain(ADMIN_Z);
    // An admin scoped to a different game is excluded.
    expect(ids).not.toContain(ADMIN_OTHER);
  });

  test("orders supers first, then roster admins alphabetically by name", () => {
    const list = listEligibleAuthors("valorant");
    // Super comes first.
    expect(list[0]?.discordId).toBe(SUPER_ID);
    // Remaining are the roster admins sorted by name: Aaron before Zed.
    const rosterNames = list.slice(1).map((a) => a.name);
    expect(rosterNames).toEqual(["Aaron", "Zed"]);
  });

  test("falls back to the discordId when a super has no roster name and no signed-in user", () => {
    const sup = listEligibleAuthors("valorant").find((a) => a.discordId === SUPER_ID);
    expect(sup?.name).toBe(SUPER_ID);
  });
});
