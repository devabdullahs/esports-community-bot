import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/*.pw.ts", "**/*.spec.ts"],
  outputDir: "test-results",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:4310",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { browserName: "chromium", viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile-chromium",
      use: { browserName: "chromium", ...devices["iPhone 13"] },
    },
  ],
});
