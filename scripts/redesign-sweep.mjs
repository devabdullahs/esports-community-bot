// Local-only visual and layout audit. Does not mutate application data.
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const origin = process.argv[2] || "http://127.0.0.1:3000";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname))
  throw new Error("Use a loopback preview.");
const output = resolve("plans/redesign-evidence/sweep");
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const routes = new Set([
  "/",
  "/live",
  "/live?tab=results",
  "/games",
  "/games/valorant",
  "/tournaments",
  "/tournaments/ewc",
  "/tournaments/archive",
  "/tournaments/1",
  "/tournaments/2",
  "/news",
  "/news/ewc",
  "/teams",
  "/teams/1",
  "/players",
  "/players/1",
  "/media/hype-cast/news/5",
  "/compare",
  "/predictions",
  "/leaderboard",
  "/clubs",
  "/clubs/standings",
  "/mvp",
  "/co-streams",
  "/media",
  "/me",
  "/login",
  "/partners",
  "/docs/mcp",
  "/docs/admin-mcp",
  "/privacy",
  "/terms",
  "/offline",
  "/not-a-real-page",
]);
const discovery = await browser.newPage();
for (const path of ["/news", "/media", "/players", "/live", "/leaderboard"]) {
  await discovery.goto(origin + path, { waitUntil: "networkidle" });
  for (const href of await discovery
    .locator("main a[href]")
    .evaluateAll((links) => links.map((a) => a.getAttribute("href")))) {
    if (
      /^\/(games\/[^/]+\/news\/\d+|media\/[^/?]+|players\/\d+|matches\/\d+|leaderboard\/[^/?]+\/\d+|predictors\/[^/?]+)$/.test(
        href,
      )
    )
      routes.add(href);
  }
}
await discovery.close();
const results = [];
for (const variant of [
  { width: 1440, locale: "en", theme: "dark" },
  { width: 390, locale: "ar", theme: "dark" },
  { width: 768, locale: "en", theme: "light" },
  { width: 320, locale: "en", theme: "light" },
]) {
  const context = await browser.newContext({
    viewport: { width: variant.width, height: 900 },
    colorScheme: variant.theme,
  });
  await context.addInitScript(
    (theme) => localStorage.setItem("theme", theme),
    variant.theme,
  );
  const page = await context.newPage();
  for (const path of routes) {
    const errors = [];
    const handler = (error) => errors.push(error.message);
    const consoleHandler = (message) => {
      if (message.type() === "error") errors.push(message.text());
    };
    page.on("console", consoleHandler);
    page.on("pageerror", handler);
    const route =
      variant.locale === "ar" ? `/ar${path === "/" ? "" : path}` : path;
    const name = `${variant.locale}-${variant.width}-${path.replace(/[^a-z0-9]+/gi, "-") || "home"}`;
    try {
      const response = await page.goto(origin + route, {
        waitUntil: "networkidle",
        timeout: 60000,
      });
      await page.evaluate(() => document.fonts.ready);
      const state = await page.evaluate(() => ({
        theme: document.documentElement.className,
        fonts: [...document.fonts]
          .filter((f) => f.family.includes("Thmanyah"))
          .map((f) => ({ weight: f.weight, status: f.status })),
        lang: document.documentElement.lang,
        dir: document.documentElement.dir,
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        heading: document.querySelector("main h1")?.textContent,
        mainCount: document.querySelectorAll("main").length,
        brokenImages: [...document.querySelectorAll("main img")]
          .filter((img) => img.complete && !img.naturalWidth)
          .map((img) => img.getAttribute("src")),
      }));
      await page.screenshot({ path: resolve(output, `${name}.png`) });
      results.push({
        route,
        ...variant,
        status: response.status(),
        ...state,
        errors,
      });
      console.log(JSON.stringify(results.at(-1)));
    } catch (error) {
      results.push({ route, ...variant, error: error.message });
      console.log("FAILED", route, error.message);
    }
    page.off("pageerror", handler);
    page.off("console", consoleHandler);
  }
  await context.close();
}
await browser.close();
await writeFile(
  resolve(output, "report.json"),
  JSON.stringify(results, null, 2),
);
console.log(`Audited ${results.length} route/viewport combinations.`);
