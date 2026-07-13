import { describe, expect, test } from "vitest";
import { GET } from "@/app/robots.txt/route";
import { metadata as loginMetadata } from "@/app/login/page";

describe("robots.txt", () => {
  test("blocks private account routes without prefix-blocking public media pages", async () => {
    const response = GET();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, s-maxage=300, must-revalidate",
    );
    expect(body).toContain("Disallow: /me$");
    expect(body).toContain("Disallow: /ar/me$");
    expect(body).not.toContain("Disallow: /me\n");
    expect(body).not.toContain("Disallow: /media");
    expect(body).not.toContain("Disallow: /login");
    expect(body).toMatch(/Sitemap: https?:\/\/[^\s]+\/sitemap\.xml/);
  });

  test("lets crawlers follow links from the noindex login page", () => {
    expect(loginMetadata.robots).toEqual({ index: false, follow: true });
  });
});
