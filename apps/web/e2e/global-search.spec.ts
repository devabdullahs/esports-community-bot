import { expect, test } from "./fixtures";

const searchDialog = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: /Search|\u0628\u062d\u062b/ });

async function openSearch(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /Search|بحث/ }).click();
  await expect(searchDialog(page)).toBeVisible();
}

test("global search opens from the keyboard, groups results, and navigates to a public team", async ({ page }) => {
  await page.goto("/");
  await openSearch(page);
  await page.keyboard.press("Escape");
  await expect(searchDialog(page)).toBeHidden();
  await page.keyboard.press("Control+K");
  await expect(searchDialog(page)).toBeVisible();
  await page.locator("[data-slot=command-input]").fill("Team Falcons");
  await expect(searchDialog(page).getByText("Teams", { exact: true })).toBeVisible();

  const result = page.getByRole("option").filter({
    has: page.getByText("Team Falcons", { exact: true }),
  });
  await expect(result).toBeVisible();
  await Promise.all([
    page.waitForURL(/\/teams\/\d+$/),
    result.click(),
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.goto("/");
  await openSearch(page);
  await page.locator("[data-slot=command-input]").fill("EWC 2026");
  await expect(searchDialog(page).getByText("Tournaments", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(searchDialog(page)).toBeHidden();
});

test("Arabic search keeps the locale prefix and has no horizontal overflow", async ({ page }) => {
  await page.goto("/ar");
  await openSearch(page);
  await page.locator("[data-slot=command-input]").fill("Team Falcons");
  const result = page.getByRole("option").filter({
    has: page.getByText("Team Falcons", { exact: true }),
  });
  await expect(result).toBeVisible();
  await Promise.all([
    page.waitForURL(/\/ar\/teams\/\d+$/),
    result.click(),
  ]);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
