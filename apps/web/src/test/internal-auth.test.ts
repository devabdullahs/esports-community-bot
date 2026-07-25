import { afterEach, describe, expect, test } from "vitest";
import { isInternalRequestAuthorized } from "@/lib/internal-auth";

const PROFILE_SECRET = "p".repeat(64);
const NEWS_SECRET = "n".repeat(64);
const original = {
  profile: process.env.EWC_DASHBOARD_INTERNAL_PROFILE_SYNC_SECRET,
  news: process.env.EWC_DASHBOARD_INTERNAL_NEWS_REVALIDATE_SECRET,
  legacy: process.env.EWC_DASHBOARD_INTERNAL_SECRET,
};

function request(secret: string) {
  return new Request("http://localhost/api/internal/test", {
    method: "POST",
    headers: { "x-ewc-internal-secret": secret },
  });
}

afterEach(() => {
  const names = {
    profile: "EWC_DASHBOARD_INTERNAL_PROFILE_SYNC_SECRET",
    news: "EWC_DASHBOARD_INTERNAL_NEWS_REVALIDATE_SECRET",
    legacy: "EWC_DASHBOARD_INTERNAL_SECRET",
  } as const;
  for (const key of Object.keys(names) as Array<keyof typeof names>) {
    const value = original[key];
    if (value === undefined) delete process.env[names[key]];
    else process.env[names[key]] = value;
  }
});

describe("internal capability authentication", () => {
  test("allows only the matching credential in the complete 2x2 matrix", () => {
    process.env.EWC_DASHBOARD_INTERNAL_PROFILE_SYNC_SECRET = PROFILE_SECRET;
    process.env.EWC_DASHBOARD_INTERNAL_NEWS_REVALIDATE_SECRET = NEWS_SECRET;

    expect(isInternalRequestAuthorized(request(PROFILE_SECRET), "profile-sync")).toBe(true);
    expect(isInternalRequestAuthorized(request(PROFILE_SECRET), "news-revalidate")).toBe(false);
    expect(isInternalRequestAuthorized(request(NEWS_SECRET), "profile-sync")).toBe(false);
    expect(isInternalRequestAuthorized(request(NEWS_SECRET), "news-revalidate")).toBe(true);
  });

  test.each([
    ["", ""],
    ["short", "short"],
    ["generate-a-profile-sync-secret", "generate-a-news-secret"],
    ["change-me-change-me-change-me-change-me", "placeholder-placeholder-placeholder"],
    [` ${"p".repeat(64)}`, `${"n".repeat(64)}\n`],
  ])("fails closed for empty, short, or placeholder credentials", (profile, news) => {
    process.env.EWC_DASHBOARD_INTERNAL_PROFILE_SYNC_SECRET = profile;
    process.env.EWC_DASHBOARD_INTERNAL_NEWS_REVALIDATE_SECRET = news;

    expect(isInternalRequestAuthorized(request(profile), "profile-sync")).toBe(false);
    expect(isInternalRequestAuthorized(request(news), "news-revalidate")).toBe(false);
  });

  test("does not read the removed legacy shared secret", () => {
    delete process.env.EWC_DASHBOARD_INTERNAL_PROFILE_SYNC_SECRET;
    delete process.env.EWC_DASHBOARD_INTERNAL_NEWS_REVALIDATE_SECRET;
    process.env.EWC_DASHBOARD_INTERNAL_SECRET = "l".repeat(64);

    expect(isInternalRequestAuthorized(request("l".repeat(64)), "profile-sync")).toBe(false);
    expect(isInternalRequestAuthorized(request("l".repeat(64)), "news-revalidate")).toBe(false);
  });
});
