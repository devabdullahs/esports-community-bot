import { expect, test } from "./fixtures";

test("primary competition links and search remain directly available at every viewport", async ({
  page,
}) => {
  await page.goto("/");
  const navigation = page.getByRole("navigation", {
    name: "Primary navigation",
    exact: true,
  });
  for (const name of ["Matches", "Tournaments", "Games", "News"]) {
    await expect(
      navigation.getByRole("link", { name, exact: true }),
    ).toBeVisible();
  }
  await expect(
    page.getByRole("button", { name: "Search", exact: true }),
  ).toBeVisible();
  const firstMatch = page.locator(".ec-match-row").first();
  await expect(firstMatch).toBeVisible();
  expect((await firstMatch.boundingBox())!.y).toBeLessThan(700);
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to main content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  const heading = await page.getByRole("heading", { level: 1 }).boundingBox();
  const header = await page.locator(".ec-site-header").boundingBox();
  expect(heading!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
});

test("match results survive reload and game filtering keeps competitors with their own scores", async ({
  page,
}) => {
  await page.goto("/live?tab=results");
  await expect(page.getByRole("tab", { name: /Results/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.reload();
  await expect(page.getByRole("tab", { name: /Results/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("combobox", { name: "Games" }).selectOption("valorant");
  const results = page.getByRole("tabpanel");
  await expect(results.getByText("T1", { exact: true }).last()).toBeVisible();
  await expect(results.getByText("Boston Breach", { exact: true })).toHaveCount(
    0,
  );
  await page.goto("/ar/live?tab=results");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const row = page.locator('.ec-match-row[data-state="finished"]').first();
  const lines = row.locator(".ec-team-line");
  await expect(lines).toHaveCount(2);
  for (const line of await lines.all()) {
    await expect(line.locator(".ec-team-name")).not.toBeEmpty();
    await expect(line.locator(".ec-team-score")).not.toHaveText("—");
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("tournament section links target real content and menu dismissal restores focus", async ({
  page,
}, testInfo) => {
  await page.goto("/tournaments/2");
  const navigation = page.getByRole("navigation", {
    name: "Tournament sections",
  });
  for (const link of await navigation.getByRole("link").all()) {
    const href = await link.getAttribute("href");
    await expect(page.locator(href!)).toHaveCount(1);
  }
  if (testInfo.project.name === "mobile-chromium") {
    const menu = page.getByRole("button", { name: "Menu", exact: true });
    await menu.click();
    const dialog = page.getByRole("dialog", { name: "Esports Community" });
    await expect(
      dialog.getByRole("link", { name: "MVP of the day" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(menu).toBeFocused();
  }
});
