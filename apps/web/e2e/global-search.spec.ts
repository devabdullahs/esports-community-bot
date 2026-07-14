import { expect, test } from "./fixtures";

const searchDialog = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: /Search|\u0628\u062d\u062b/ });

async function openSearch(page: import("@playwright/test").Page, mobile: boolean) {
  if (mobile) {
    await page.getByRole("button", { name: /Menu|\u0627\u0644\u0642\u0627\u0626\u0645\u0629/ }).click();
    await page.getByRole("button", { name: /Search|\u0628\u062d\u062b/ }).click();
  } else {
    await page.getByRole("button", { name: /Search|\u0628\u062d\u062b/ }).click();
  }
  await expect(searchDialog(page)).toBeVisible();
}

test("global search opens from the keyboard, groups results, and navigates to a public team", async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === "mobile-chromium";
  await page.goto("/");
  await openSearch(page, mobile);
  await page.keyboard.press("Escape");
  await expect(searchDialog(page)).toBeHidden();
  await page.keyboard.press("Control+K");
  await expect(searchDialog(page)).toBeVisible();
  await page.locator("[data-slot=command-input]").fill("Team Falcons");
  await expect(page.getByText("Teams", { exact: true })).toBeVisible();

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
  await openSearch(page, mobile);
  await page.locator("[data-slot=command-input]").fill("EWC 2026");
  await expect(page.getByText("Tournaments", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(searchDialog(page)).toBeHidden();
});

test("Arabic search keeps the locale prefix and has no horizontal overflow", async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === "mobile-chromium";
  await page.goto("/ar");
  await openSearch(page, mobile);
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
