import { describe, expect, test, vi } from "vitest";

const { getRequestLocale } = vi.hoisted(() => ({ getRequestLocale: vi.fn() }));

vi.mock("@/lib/request-locale", () => ({ getRequestLocale }));

import { GET } from "@/app/robots.txt/route";
import { generateMetadata } from "@/app/login/page";
import { copy } from "@/lib/i18n";

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

  test("keeps the localized login metadata noindex while allowing follow", async () => {
    getRequestLocale.mockResolvedValueOnce("en");
    const english = await generateMetadata();
    getRequestLocale.mockResolvedValueOnce("ar");
    const arabic = await generateMetadata();

    expect(english.title).toBe(copy.en.login.metadataTitle);
    expect(arabic.title).toBe(copy.ar.login.metadataTitle);
    expect(english.robots).toEqual({ index: false, follow: true });
    expect(arabic.robots).toEqual({ index: false, follow: true });
  });
});
