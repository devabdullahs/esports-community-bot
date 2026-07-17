import { expect, test } from "./fixtures";

test("live match center renders localized live data without horizontal overflow", async ({ page }, testInfo) => {
  await page.goto("/live");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Live matches and the next games");
  await expect(page.getByRole("tab", { name: /Live now/ })).toBeVisible();
  await expect(page.getByText("Team Falcons", { exact: true })).toBeVisible();
  await expect(page.locator('a[href^="/tournaments/"]').first()).toBeVisible();

  await page.goto("/ar/live");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).not.toBeEmpty();
  await expect(page.locator('a[href^="/ar/tournaments/"]').first()).toBeVisible();

  if (testInfo.project.name === "mobile-chromium") {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
