// Read-only browser capture for the redesign; targets are explicit CLI arguments.
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [
  url = "http://127.0.0.1:3000",
  name = "preview",
  width = "1440",
  theme = "dark",
] = process.argv.slice(2);
const output = resolve("plans/redesign-evidence");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: Number(width), height: Number(width) < 600 ? 844 : 960 },
    colorScheme: theme,
  });
  await page.addInitScript(
    (theme) => localStorage.setItem("theme", theme),
    theme,
  );
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page
    .locator("h1")
    .first()
    .waitFor({ timeout: 30000 })
    .catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: resolve(output, `${name}.png`),
    fullPage: true,
  });
  await page.screenshot({
    path: resolve(output, `${name}-viewport.png`),
    fullPage: false,
  });
  const state = await page.evaluate(() => ({
    title: document.title,
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    theme: document.documentElement.className,
    fonts: [...document.fonts]
      .filter((f) => f.family.includes("Thmanyah"))
      .map((f) => ({ weight: f.weight, status: f.status })),
    viewport: innerWidth,
    width: document.documentElement.scrollWidth,
    headings: [...document.querySelectorAll("h1,h2,h3")].map(
      (e) => e.textContent,
    ),
    text: document.body.innerText.slice(0, 18000),
    overflow: [...document.querySelectorAll("main *")]
      .filter(
        (e) =>
          e.getBoundingClientRect().right > innerWidth + 2 &&
          getComputedStyle(e).position !== "absolute",
      )
      .slice(0, 12)
      .map((e) => ({ tag: e.tagName, class: e.className })),
  }));
  await writeFile(
    resolve(output, `${name}.json`),
    JSON.stringify({ ...state, errors }, null, 2),
  );
  console.log(
    JSON.stringify({
      name,
      path: resolve(output, `${name}.png`),
      ...state,
      text: state.text.slice(0, 1800),
      errors,
    }),
  );
} finally {
  await browser.close();
}
