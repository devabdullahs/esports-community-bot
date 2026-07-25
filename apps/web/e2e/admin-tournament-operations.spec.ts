import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const execFileAsync = promisify(execFile);
const consumerPath = resolve(
  process.cwd(),
  "../../scripts/e2e-tournament-operations-consumer.mjs",
);

async function consumeNextOperation(
  expected: string,
  action: "stage" | "complete" | "archive" | "reactivate",
  name: string,
  url: string,
) {
  const { stdout } = await execFileAsync(process.execPath, [
    consumerPath,
    "--expected",
    expected,
    "--action",
    action,
    "--name",
    name,
    "--url",
    url,
  ], {
    env: process.env,
    timeout: 15_000,
  });
  const match = stdout.match(/E2E_RESULT (.+)$/m);
  expect(match, "the fake consumer should return a bounded result").not.toBeNull();
  return JSON.parse(match?.[1] || "{}") as {
    operation: string;
    tournamentId: number | null;
  };
}

async function openActions(row: Locator) {
  await row.getByRole("button", { name: "Actions" }).click();
}

async function confirmLifecycle(page: Page, label: "Archive" | "Reactivate") {
  await page.getByRole("menuitem", { name: label, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm tournament change" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
}

function tournamentRow(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).locator("xpath=ancestor::tr");
}

test("super admin stages, recovers, archives, and reactivates a tournament", async ({
  page,
}, testInfo) => {
  const suffix = testInfo.project.name === "mobile-chromium" ? " mobile" : " desktop";
  const stagedName = `E2E staged tournament${suffix}`;
  const stagedSource =
    `https://liquipedia.net/valorant/E2E_Tournament_Operations_${suffix.trim()}`;
  await page.goto("/admin/tournaments");
  await expect(page.getByRole("heading", { level: 1, name: "Tournament operations" })).toBeVisible();

  await page.getByLabel("Tournament URL or identifier").fill(stagedSource);
  await page.getByRole("button", { name: "Queue validation" }).click();
  await expect(page.getByText("Request queued", { exact: true }).first()).toBeVisible();

  const staged = await consumeNextOperation(
    "validate_and_activate",
    "stage",
    stagedName,
    stagedSource,
  );
  expect(staged.tournamentId).not.toBeNull();

  await page.reload();
  await page.getByPlaceholder("Search tournaments").fill(stagedName);
  let row = tournamentRow(page, stagedName);
  await expect(row).toBeVisible();
  await expect(row.getByText("Succeeded", { exact: true })).toBeVisible();

  await openActions(row);
  await page.getByRole("menuitem", { name: "Sync standings", exact: true }).click();
  const standings = await consumeNextOperation(
    "sync_standings",
    "complete",
    stagedName,
    stagedSource,
  );
  expect(standings.tournamentId).toBe(staged.tournamentId);

  await page.reload();
  await page.getByPlaceholder("Search tournaments").fill(stagedName);
  row = tournamentRow(page, stagedName);
  await openActions(row);
  await confirmLifecycle(page, "Archive");
  const archived = await consumeNextOperation("archive", "archive", stagedName, stagedSource);
  expect(archived.tournamentId).toBe(staged.tournamentId);

  await page.reload();
  await page.getByPlaceholder("Search tournaments").fill(stagedName);
  row = tournamentRow(page, stagedName);
  await expect(row.getByText("Archived", { exact: true })).toBeVisible();
  await openActions(row);
  await confirmLifecycle(page, "Reactivate");
  const reactivated = await consumeNextOperation(
    "reactivate",
    "reactivate",
    stagedName,
    stagedSource,
  );
  expect(reactivated.tournamentId).toBe(staged.tournamentId);

  await page.reload();
  await page.getByPlaceholder("Search tournaments").fill(stagedName);
  row = tournamentRow(page, stagedName);
  await expect(row.getByText("Active", { exact: true })).toBeVisible();
  await expect(page.getByText("e2e_completed", { exact: true }).first()).toBeVisible();

  if (testInfo.project.name === "mobile-chromium") {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("Arabic tournament operations keeps the admin registry RTL", async ({ page }, testInfo) => {
  await page.goto("/ar/admin/tournaments");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("main table").first()).toBeVisible();

  if (testInfo.project.name === "mobile-chromium") {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
