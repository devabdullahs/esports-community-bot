import { describe, expect, test } from "vitest";
import { loginCallbackUrl } from "@/lib/login-navigation";

describe("loginCallbackUrl", () => {
  test("uses the localized profile fallback for missing or empty values", () => {
    expect(loginCallbackUrl(null, "en")).toBe("/me");
    expect(loginCallbackUrl(undefined, "ar")).toBe("/ar/me");
    expect(loginCallbackUrl("", "en")).toBe("/me");
  });

  test("accepts internal paths with queries and hashes", () => {
    expect(loginCallbackUrl("/me", "en")).toBe("/me");
    expect(loginCallbackUrl("/admin/news/new", "en")).toBe("/admin/news/new");
    expect(loginCallbackUrl("/me?tab=predictions#round", "ar")).toBe("/ar/me?tab=predictions#round");
  });

  test("normalizes an existing locale prefix to the current locale", () => {
    expect(loginCallbackUrl("/ar/me?tab=predictions#round", "en")).toBe("/me?tab=predictions#round");
    expect(loginCallbackUrl("/me?tab=predictions#round", "ar")).toBe("/ar/me?tab=predictions#round");
  });

  test.each([
    "https://example.com/me",
    "//example.com/me",
    "/\\example.com/me",
    "/me\r\nLocation: https://example.com",
    "/api",
    "/api/session",
    "/login",
    "/login/help",
    "   ",
    `/${"a".repeat(2_049)}`,
  ])("rejects unsafe callback input %j", (value) => {
    expect(loginCallbackUrl(value, "en")).toBe("/me");
  });

  test.each([
    "/me/../api",
    "/%2e%2e/api",
    "/%61pi",
    "/%6c%6f%67%69%6e",
    "/teams%2Fapi",
    "/teams%5capi",
    "/%00",
    "/%0d",
    "/%252fapi",
    "/%",
  ])("rejects encoded and canonicalized blocked paths %j", (value) => {
    expect(loginCallbackUrl(value, "ar")).toBe("/ar/me");
  });

  test("keeps safe route segment boundaries", () => {
    expect(loginCallbackUrl("/apiculture", "en")).toBe("/apiculture");
    expect(loginCallbackUrl("/login-help", "ar")).toBe("/ar/login-help");
  });
});
