import { expect, test } from "./fixtures";

const locales = [
  {
    path: "/login",
    dir: "ltr",
    primary: "Continue with Discord",
    browse: "Browse the community",
    terms: "Terms of Service",
    privacy: "Privacy Policy",
    failedTitle: "Sign in failed",
    failedMessage: "Discord sign-in failed.",
  },
  {
    path: "/ar/login",
    dir: "rtl",
    primary: "\u0627\u0644\u0645\u062a\u0627\u0628\u0639\u0629 \u0639\u0628\u0631 \u062f\u064a\u0633\u0643\u0648\u0631\u062f",
    browse: "\u062a\u0635\u0641\u0651\u062d \u0627\u0644\u0645\u062c\u062a\u0645\u0639",
    terms: "\u0634\u0631\u0648\u0637 \u0627\u0644\u062e\u062f\u0645\u0629",
    privacy: "\u0633\u064a\u0627\u0633\u0629 \u0627\u0644\u062e\u0635\u0648\u0635\u064a\u0629",
    failedTitle: "\u0641\u0634\u0644 \u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062f\u062e\u0648\u0644",
    failedMessage: "\u0641\u0634\u0644 \u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062f\u062e\u0648\u0644 \u0639\u0628\u0631 \u062f\u064a\u0633\u0643\u0648\u0631\u062f.",
  },
] as const;

const authPath = "**/api/auth/sign-in/social";

function primaryButton(page: import("@playwright/test").Page, label: string) {
  return page.getByRole("button", { name: label });
}

function primaryAction(page: import("@playwright/test").Page) {
  return page.locator('main button[data-slot="button"]');
}

test("login keeps the public shell, bilingual direction, and responsive actions", async ({ page }, testInfo) => {
  for (const locale of locales) {
    await page.goto(locale.path);
    await expect(page.locator("html")).toHaveAttribute("dir", locale.dir);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex.*follow/);
    await expect(page.locator("header")).toBeVisible();

    const main = page.locator("main");
    const card = main.locator('[data-slot="card"]');
    const primary = primaryButton(page, locale.primary);
    const browse = page.getByRole("button", { name: locale.browse });
    await expect(card).toBeVisible();
    await expect(primary).toBeVisible();
    await expect(browse).toBeVisible();
    await expect(main.getByRole("link", { name: locale.terms })).toBeVisible();
    await expect(main.getByRole("link", { name: locale.privacy })).toBeVisible();
    await expect(main.locator(`a[href="${locale.dir === "rtl" ? "/ar" : "/"}"]`)).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const cardBox = await card.boundingBox();
    expect(cardBox).not.toBeNull();
    if (cardBox) {
      expect(cardBox.x).toBeGreaterThanOrEqual(0);
      expect(cardBox.x + cardBox.width).toBeLessThanOrEqual((testInfo.project.use.viewport?.width ?? 390) + 1);
      if (testInfo.project.name === "desktop-chromium") {
        expect(Math.abs(cardBox.x + cardBox.width / 2 - 720)).toBeLessThan(24);
        expect(cardBox.y).toBeGreaterThan(100);
      }
    }

    await page.locator("footer").scrollIntoViewIfNeeded();
    await expect(page.locator("footer")).toBeVisible();
  }
});

test("login keeps the footer pinned to the bottom on tall viewports", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });

  for (const locale of locales) {
    await page.goto(locale.path);

    const footer = page.locator("footer");
    await expect(footer).toBeVisible();

    const footerBox = await footer.boundingBox();
    expect(footerBox).not.toBeNull();
    if (footerBox) {
      expect(Math.abs(footerBox.y + footerBox.height - 1080)).toBeLessThanOrEqual(1);
    }
  }
});

test("login sends normalized localized callback paths without contacting Discord", async ({ page }) => {
  const callbacks: string[] = [];
  await page.route(authPath, async (route) => {
    callbacks.push(route.request().postDataJSON().callbackURL);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ redirect: false }),
    });
  });

  await page.goto("/login?callbackURL=%2Fme%3Ftab%3Dpredictions%23round");
  await primaryButton(page, locales[0].primary).click();
  await expect.poll(() => callbacks).toEqual(["/me?tab=predictions#round"]);

  await page.goto("/ar/login?callbackURL=https%3A%2F%2Fexample.com%2Foutside");
  await primaryButton(page, locales[1].primary).click();
  await expect.poll(() => callbacks).toEqual(["/me?tab=predictions#round", "/ar/me"]);
});

test("login disables duplicate submissions while a sign-in request is pending", async ({ page }) => {
  let requests = 0;
  let releaseRequest: (() => void) | undefined;
  const requestHeld = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });

  await page.route(authPath, async (route) => {
    requests += 1;
    await requestHeld;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ redirect: false }),
    });
  });

  await page.goto("/login");
  const primary = primaryAction(page);
  await primary.evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect.poll(() => requests).toBe(1);
  await expect(primary).toBeDisabled();
  await expect(primary).toHaveAttribute("aria-busy", "true");

  releaseRequest?.();
  await expect(primary).toBeEnabled();
});

test("login recovers from returned and rejected sign-in failures", async ({ page }) => {
  let requests = 0;
  await page.route(authPath, async (route) => {
    requests += 1;
    if (requests === 1) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ message: "The local sign-in request was rejected." }),
      });
      return;
    }
    await route.abort("failed");
  });

  await page.goto(locales[1].path);
  const primary = primaryAction(page);
  const alert = page.locator('main [data-slot="alert"]');

  await primary.click();
  await expect(alert).toContainText(locales[1].failedTitle);
  await expect(alert).toContainText(locales[1].failedMessage);
  await expect(primary).toBeEnabled();

  await primary.click();
  await expect(alert).toContainText(locales[1].failedTitle);
  await expect(alert).toContainText(locales[1].failedMessage);
  await expect(primary).toBeEnabled();
  expect(requests).toBe(2);
});
