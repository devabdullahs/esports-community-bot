import { expect, test } from "./fixtures";

test("authenticated overview shows followed activity and deep links", async ({ page }, testInfo) => {
  await page.goto("/me");
  const today = page.locator("section[aria-labelledby='today-for-you-title']");

  await expect(today.getByRole("heading", { name: "Today for you" })).toBeVisible();
  await expect(today.getByText("Team Falcons vs Team Liquid")).toBeVisible();
  await expect(today.getByText("Team Vitality vs Gen.G")).toBeVisible();
  await expect(today.getByText("Falcons result ready")).toBeVisible();
  await expect(today.getByText("Today picks")).toBeVisible();
  await expect(today.locator("time").first()).toHaveAttribute("dateTime", /T/);

  const followingLink = today.getByRole("link", { name: "View all" }).first();
  await expect(followingLink).toHaveAttribute("href", "/me?tab=following");
  await Promise.all([
    page.waitForURL(/\/me\?tab=following$/),
    followingLink.click(),
  ]);

  if (testInfo.project.name === "mobile-chromium") {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("Arabic overview keeps localized account links and RTL layout", async ({ page }, testInfo) => {
  await page.goto("/ar/me");
  const today = page.locator("section[aria-labelledby='today-for-you-title']");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(today.getByRole("heading", { name: "اليوم لأجلك" })).toBeVisible();
  await expect(today.getByRole("link", { name: "عرض الكل" }).first()).toHaveAttribute("href", "/ar/me?tab=following");

  if (testInfo.project.name === "mobile-chromium") {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
