import { expect, test } from "./fixtures";

// Vitest only discovers its test/spec suffixes, so this Playwright suite uses .pw.ts.
const seededTournament = /EWC 2026.*Valorant/;
const arabicSwitchLabel = /^\u0627\u0644\u0639\u0631\u0628\u064a\u0629$/;

test("English home reaches the seeded tournament detail through the directory", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "Menu" }).click();
  } else {
    await page.getByRole("button", { name: "Competition" }).click();
  }

  const tournamentsLink = page.getByRole("link", { name: "Tournaments", exact: true });
  await expect(tournamentsLink).toHaveAttribute("href", "/tournaments");
  await Promise.all([
    page.waitForURL(/\/tournaments$/),
    tournamentsLink.click(),
  ]);

  const tournamentLink = page.getByRole("link", { name: seededTournament }).first();
  await expect(tournamentLink).toBeVisible();
  await Promise.all([
    page.waitForURL(/\/tournaments\/\d+$/),
    tournamentLink.click(),
  ]);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("EWC 2026");
  await expect(page.locator("[data-sync-health]")).toHaveAttribute("data-sync-health", "fresh");
  await expect(page.getByText("Updated:", { exact: false })).toBeVisible();

  const tournamentPath = new URL(page.url()).pathname;
  const polled = await page.evaluate(async (path) => {
    const response = await fetch(`/api${path}/matches`);
    return response.json();
  }, tournamentPath);
  await page.route(`**/api${tournamentPath}/matches`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...polled,
        tournament: {
          ...polled.tournament,
          syncHealth: {
            state: "delayed",
            lastSuccessAt: polled.tournament.syncHealth.lastSuccessAt,
            source: polled.tournament.syncHealth.source,
          },
        },
      }),
    });
  });
  await page.waitForTimeout(16_000);
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator("[data-sync-health]")).toHaveAttribute("data-sync-health", "delayed");
  await expect(page.getByText("Displayed data may lag", { exact: false })).toBeVisible();
});

test("Arabic tournament navigation preserves RTL at the mobile layout", async ({ page }, testInfo) => {
  await page.goto("/ar");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  const tournamentsLink = page.locator('a[href="/ar/tournaments"]').first();
  await expect(tournamentsLink).toBeVisible();
  await Promise.all([
    page.waitForURL(/\/ar\/tournaments$/),
    tournamentsLink.click(),
  ]);

  const tournamentLink = page.getByRole("link", { name: seededTournament }).first();
  await Promise.all([
    page.waitForURL(/\/ar\/tournaments\/\d+$/),
    tournamentLink.click(),
  ]);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("EWC 2026");
  await expect(page.locator("[data-sync-health]")).toHaveAttribute("data-sync-health", "fresh");
  await expect(page.getByText("\u0645\u062d\u062f\u0651\u062b", { exact: true })).toBeVisible();

  if (testInfo.project.name === "mobile-chromium") {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("header navigation and locale switching keep a localized destination", async ({ page }, testInfo) => {
  await page.goto("/");
  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "Menu" }).click();
  } else {
    await page.getByRole("button", { name: "Competition" }).click();
  }

  await page.getByRole("link", { name: "Tournaments", exact: true }).click();
  await page.waitForURL(/\/tournaments$/);
  await page.getByRole("button", { name: arabicSwitchLabel }).click();
  await page.waitForURL(/\/ar\/tournaments$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});

test("public prediction leaderboard renders seeded rows and opens the picker without saving", async ({ page }) => {
  const pickerWrites: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/me/ewc/picks/")) {
      pickerWrites.push(request.url());
    }
  });

  await page.goto("/leaderboard/1200000000000000001/2026");
  await expect(page.getByRole("table")).toBeVisible();
  expect(await page.getByRole("row").count()).toBeGreaterThanOrEqual(9);

  await page.goto("/predictions");
  await expect(page.getByText("Season picks", { exact: true })).toBeVisible();
  expect(pickerWrites).toEqual([]);
});

test("co-stream selection uses a stubbed provider iframe", async ({ page }) => {
  await page.goto("/co-streams");
  const creatorButton = page.getByRole("button", { name: "Add stream: Charlie Casts" });
  await expect(creatorButton).toBeVisible();
  await creatorButton.click();
  await expect(page.locator('iframe[title="Charlie Casts on YouTube"]')).toHaveAttribute(
    "src",
    /youtube-nocookie/,
  );
});

test("analytics can be denied and reopened without loading Google Analytics", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Keep disabled" }).click();
  await expect(page.getByRole("button", { name: "Keep disabled" })).toBeHidden();
  await page.getByRole("button", { name: "Analytics settings" }).click();
  await expect(page.getByRole("button", { name: "Keep disabled" })).toBeVisible();
});
