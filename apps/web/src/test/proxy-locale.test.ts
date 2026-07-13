import { NextRequest } from "next/server";
import { describe, expect, test } from "vitest";
import { LOCALE_ROUTE_HEADER } from "@/lib/i18n";
import { proxy } from "@/proxy";

function request(
  pathname: string,
  options: {
    cookie?: string;
    routeLocale?: "ar" | "en";
    accept?: string;
    method?: string;
    rsc?: boolean;
    prefetch?: boolean;
  } = {},
) {
  const headers = new Headers();
  if (options.cookie) headers.set("cookie", `ewc_locale=${options.cookie}`);
  if (options.routeLocale) headers.set(LOCALE_ROUTE_HEADER, options.routeLocale);
  if (options.accept) headers.set("accept", options.accept);
  if (options.rsc) headers.set("rsc", "1");
  if (options.prefetch) headers.set("next-router-prefetch", "1");
  return new NextRequest(`https://esportscommunity.net${pathname}`, {
    headers,
    method: options.method,
  });
}

function forwardedLocale(response: Response) {
  return response.headers.get(`x-middleware-request-${LOCALE_ROUTE_HEADER}`);
}

describe("path-authoritative locale proxy", () => {
  test("an unprefixed public path is English even with an old Arabic cookie", () => {
    const response = proxy(request("/games", { cookie: "ar" }));

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(forwardedLocale(response)).toBe("en");
    expect(response.cookies.get("ewc_locale")?.value).toBe("en");
  });

  test("Arabic private paths keep a visible /ar prefix", () => {
    const response = proxy(request("/admin/mcp", { cookie: "ar" }));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://esportscommunity.net/ar/admin/mcp",
    );
    expect(response.cookies.get("ewc_locale")?.value).toBe("ar");
  });

  test("an Arabic-prefixed private path rewrites internally without dropping /ar", () => {
    const response = proxy(request("/ar/admin/mcp"));

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://esportscommunity.net/admin/mcp",
    );
    expect(forwardedLocale(response)).toBe("ar");
    expect(response.cookies.get("ewc_locale")?.value).toBe("ar");
  });

  test("English private paths remain unprefixed", () => {
    const response = proxy(request("/me?tab=notifications", { cookie: "en" }));

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(forwardedLocale(response)).toBe("en");
    expect(response.cookies.get("ewc_locale")?.value).toBe("en");
  });

  test("API paths are never locale-routed", () => {
    const response = proxy(request("/api/me/follows", { cookie: "ar" }));

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(forwardedLocale(response)).toBeNull();
    expect(response.cookies.get("ewc_locale")).toBeUndefined();
  });

  test.each([
    ["/games", "en"],
    ["/ar/games", "ar"],
  ])("cookie-free HTML %s is locale-correct and edge-cacheable", (pathname, locale) => {
    const response = proxy(request(pathname, { accept: "text/html" }));

    expect(forwardedLocale(response)).toBe(locale);
    expect(response.cookies.get("ewc_locale")).toBeUndefined();
    expect(response.headers.get("cloudflare-cdn-cache-control")).toContain("max-age=60");
  });

  test("any cookie suppresses public HTML caching and remains locale-correct", () => {
    const response = proxy(request("/games", { accept: "text/html", cookie: "ar" }));

    expect(forwardedLocale(response)).toBe("en");
    expect(response.cookies.get("ewc_locale")?.value).toBe("en");
    expect(response.headers.get("cloudflare-cdn-cache-control")).toBeNull();
  });

  test("a client-spoofed locale header cannot poison the English cache key", () => {
    const response = proxy(request("/games", { accept: "text/html", routeLocale: "ar" }));

    expect(forwardedLocale(response)).toBe("en");
    expect(response.headers.get("cloudflare-cdn-cache-control")).toBeNull();
  });

  test.each([
    "/admin",
    "/ar/admin",
    "/login",
    "/ar/login",
    "/me",
    "/ar/me",
  ])("private HTML %s is never edge-cacheable", (pathname) => {
    const response = proxy(request(pathname, { accept: "text/html" }));
    expect(response.headers.get("cloudflare-cdn-cache-control")).toBeNull();
  });

  test.each([
    ["query", "/games?page=2", {}],
    ["RSC", "/games", { rsc: true }],
    ["prefetch", "/games", { prefetch: true }],
    ["non-HTML", "/games", { accept: "application/json" }],
    ["non-GET", "/games", { method: "POST" }],
    ["asset-like", "/robots.txt", {}],
  ])("%s requests are never edge-cacheable", (_name, pathname, extra) => {
    const response = proxy(request(pathname, { accept: "text/html", ...extra }));
    expect(response.headers.get("cloudflare-cdn-cache-control")).toBeNull();
  });
});
