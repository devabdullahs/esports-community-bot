import { describe, expect, test } from "vitest";
import { deriveAcquisition } from "@/components/analytics/analytics-tracker";

describe("privacy-safe analytics acquisition", () => {
  test.each([
    ["https://x.com/community/status/1?private=yes", "x"],
    ["https://discord.gg/community?invite=private", "discord"],
    ["https://www.google.com/search?q=private", "google"],
    ["https://www.google.co.uk/search?q=private", "google"],
    ["https://www.bing.com/search?q=private", "bing"],
    ["https://publisher.example/article?private=yes", "other_referral"],
    ["", "direct"],
  ])("reduces referrer %s to %s", (referrer, source) => {
    expect(deriveAcquisition("https://community.example/news", referrer)).toEqual({ source });
  });

  test("uses an allowlisted UTM source and bounded campaign without retaining the query", () => {
    expect(
      deriveAcquisition(
        "https://community.example/news?utm_source=twitter&utm_campaign=EWC_NEWS&destination=https%3A%2F%2Fprivate.example",
        "",
      ),
    ).toEqual({ source: "x", campaign: "ewc_news" });
  });

  test("maps unknown sources to other referral and drops unsafe campaign labels", () => {
    expect(
      deriveAcquisition(
        "https://community.example/news?utm_source=newsletter&utm_campaign=raw%20query%3Fsecret%3Dyes",
        "https://mail.example/message/1",
      ),
    ).toEqual({ source: "other_referral" });
  });

  test("treats same-origin navigation as direct", () => {
    expect(
      deriveAcquisition(
        "https://community.example/news",
        "https://community.example/tournaments?private=yes",
      ),
    ).toEqual({ source: "direct" });
  });
});
