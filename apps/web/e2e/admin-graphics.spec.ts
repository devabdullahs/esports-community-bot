import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures";

test("admin navigation remains searchable without obscuring the workspace", async ({ page }, testInfo) => {
  await page.goto("/admin");
  await expect(page.getByRole("main")).toHaveCount(1);
  const mobile = testInfo.project.name === "mobile-chromium";
  if (mobile) await page.getByRole("main").getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("textbox", { name: "Find an admin tool" }).fill("graphics");
  await expect(page.getByRole("link", { name: "Graphics generator", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Audit log", exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Find an admin tool" }).fill("");
  await expect(page.getByRole("link", { name: "Audit log", exact: true })).toBeVisible();
  if (!mobile) {
    const community = page.getByRole("navigation", { name: "Community", exact: true });
    await expect(community.getByRole("button", { name: "More", exact: true })).toBeVisible();
    await expect(community.getByRole("button", { name: "EWC", exact: true })).toBeVisible();
    const header = await page.getByRole("banner").boundingBox();
    const search = await page.getByRole("textbox", { name: "Find an admin tool" }).boundingBox();
    expect(search!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
  }
});

test("graphics filters sources, blocks stale exports, and restores export dimensions", async ({ page }) => {
  await page.route("**/api/admin/graphics", (route) => route.fulfill({
    contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAAUSURBVAiZY2RgYPjPwMDAwMQABQAOKAEDtjjK0wAAAABJRU5ErkJggg==", "base64"),
  }));
  await page.goto("/admin/graphics");
  const preview = page.getByRole("region", { name: "Graphic preview and export" });
  const download = preview.getByRole("button", { name: "Download", exact: true });
  await expect(download).toBeEnabled();
  await page.getByRole("switch", { name: "Auto preview", exact: true }).click();

  await page.getByRole("textbox", { name: "Search sources" }).fill("no-such-source-987654");
  await expect(page.getByRole("option")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.getByRole("combobox", { name: "Filter source status" }).click();
  await page.getByRole("option", { name: "Finished", exact: true }).click();
  const sourceList = page.getByRole("listbox", { name: "Graphics sources" });
  await expect(sourceList.getByRole("option").first()).toContainText("FINAL");

  await page.getByRole("button", { name: "Generate preview", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Restore / })).toHaveCount(1);
  await page.getByRole("button", { name: "1:1 1080x1080", exact: true }).click();
  await expect(download).toBeDisabled();
  await expect(page.getByText(/Preview out of date/)).toBeVisible();
  await page.getByRole("button", { name: /^Restore / }).click();
  await expect(download).toBeEnabled();
  for (const [label, extension, magic] of [["JPEG", "jpg", "ffd8ff"], ["WebP", "webp", "52494646"], ["PNG", "png", "89504e47"]]) {
    await page.getByRole("combobox", { name: "Image file format" }).click();
    await page.getByRole("option", { name: label, exact: true }).click();
    const exported = page.waitForEvent("download");
    await download.click();
    const file = await exported;
    expect(file.suggestedFilename()).toBe(`graphics-match-result-16x9-2x.${extension}`);
    const bytes = await readFile((await file.path())!);
    expect(bytes.toString("hex").startsWith(magic)).toBe(true);
  }
  await expect(preview.getByRole("alert")).toHaveCount(0);
});
