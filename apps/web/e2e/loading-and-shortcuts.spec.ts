import { expect, test } from "./fixtures";

test.use({ serviceWorkers: "block" });

test("homepage daily shortcuts keep localized destinations", async ({ page }) => {
  for (const locale of ["", "/ar"]) {
    await page.goto(locale || "/");
    const shortcuts = page.locator(".ec-daily-shortcuts");
    await expect(shortcuts.getByRole("link")).toHaveCount(3);
    for (const href of ["/me", "/predictions", "/clubs/standings"]) {
      await expect(shortcuts.locator(`a[href="${locale}${href}"]`)).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("slow navigation shows animated loading feedback and respects reduced motion", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  let release!: () => void;
  const responseGate = new Promise<void>((resolve) => { release = resolve; });
  await page.route((url) => url.pathname === "/live" && url.searchParams.has("_rsc"), async (route) => {
    await responseGate;
    await route.continue();
  });
  try {
    await page.getByRole("navigation", { name: "Primary navigation", exact: true }).getByRole("link", { name: "Matches", exact: true }).click();
    const loading = page.locator(".ec-navigation-feedback");
    await expect(loading).toBeVisible();
    const spinner = loading.locator(".ec-loading-spinner");
    await expect(spinner).toHaveCSS("animation-name", "ec-loading-rotate");
    await expect(spinner).toHaveCSS("animation-iteration-count", "infinite");
    await page.screenshot({ path: testInfo.outputPath("loading.png") });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(spinner).toHaveCSS("animation-name", "none");
    await expect(loading).toContainText(/[1-9]\d*s/);
  } finally {
    release();
  }
  await expect(page.locator(".ec-navigation-feedback")).toHaveCount(0);
});
