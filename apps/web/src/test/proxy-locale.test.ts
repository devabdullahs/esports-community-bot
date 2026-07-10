import { NextRequest } from "next/server";
import { describe, expect, test } from "vitest";
import { LOCALE_ROUTE_HEADER } from "@/lib/i18n";
import { proxy } from "@/proxy";

function request(
  pathname: string,
  options: { cookie?: string; routeLocale?: "ar" | "en" } = {},
) {
  const headers = new Headers();
  if (options.cookie) headers.set("cookie", `ewc_locale=${options.cookie}`);
  if (options.routeLocale) headers.set(LOCALE_ROUTE_HEADER, options.routeLocale);
  return new NextRequest(`https://esportscommunity.net${pathname}`, { headers });
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
});
