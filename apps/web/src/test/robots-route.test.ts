import { describe, expect, test } from "vitest";
import { GET } from "@/app/robots.txt/route";

describe("robots.txt", () => {
  test("blocks private account routes without prefix-blocking public media pages", async () => {
    const response = GET();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Disallow: /me$");
    expect(body).toContain("Disallow: /ar/me$");
    expect(body).not.toContain("Disallow: /me\n");
    expect(body).not.toContain("Disallow: /media");
    expect(body).toMatch(/Sitemap: https?:\/\/[^\s]+\/sitemap\.xml/);
  });
});
