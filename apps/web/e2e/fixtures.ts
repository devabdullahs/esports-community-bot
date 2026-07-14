import { expect, test as base } from "@playwright/test";

const STUBBED_EXTERNAL_HOSTS = new Set([
  "assets.esportscommunity.net",
  "player.kick.com",
  "player.twitch.tv",
  "www.youtube-nocookie.com",
]);

export const test = base.extend({
  page: async ({ page }, fixtureUse) => {
    const unexpectedRequests: string[] = [];

    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
        await route.continue();
        return;
      }
      if (STUBBED_EXTERNAL_HOSTS.has(url.hostname)) {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><title>Stubbed stream provider</title>",
        });
        return;
      }
      unexpectedRequests.push(`${url.origin}${url.pathname}`);
      await route.abort();
    });

    await fixtureUse(page);
    expect(unexpectedRequests, "unexpected browser requests escaped localhost").toEqual([]);
  },
});

export { expect };
