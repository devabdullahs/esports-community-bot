import { describe, expect, test } from "vitest";
import {
  normalizeGoogleAnalyticsMeasurementId,
  parseGoogleAnalyticsConsent,
  shouldLoadGoogleAnalytics,
} from "@/lib/google-analytics";

describe("Google Analytics consent boundary", () => {
  test("accepts only GA4 measurement IDs", () => {
    expect(normalizeGoogleAnalyticsMeasurementId(" g-6kskw48j1p ")).toBe("G-6KSKW48J1P");
    expect(normalizeGoogleAnalyticsMeasurementId("UA-123-4")).toBeNull();
    expect(normalizeGoogleAnalyticsMeasurementId("G-ABC';alert(1)//")).toBeNull();
    expect(normalizeGoogleAnalyticsMeasurementId(undefined)).toBeNull();
  });

  test("fails closed for missing or malformed stored choices", () => {
    expect(parseGoogleAnalyticsConsent("granted")).toBe("granted");
    expect(parseGoogleAnalyticsConsent("denied")).toBe("denied");
    expect(parseGoogleAnalyticsConsent("yes")).toBeNull();
    expect(parseGoogleAnalyticsConsent(null)).toBeNull();
  });

  test("loads after explicit consent unless Global Privacy Control is enabled", () => {
    const measurementId = "G-6KSKW48J1P";
    expect(shouldLoadGoogleAnalytics({ measurementId, consent: null })).toBe(false);
    expect(shouldLoadGoogleAnalytics({ measurementId, consent: "denied" })).toBe(false);
    expect(shouldLoadGoogleAnalytics({ measurementId, consent: "granted" })).toBe(true);
    expect(
      shouldLoadGoogleAnalytics({ measurementId, consent: "granted", globalPrivacyControl: true }),
    ).toBe(false);
    expect(shouldLoadGoogleAnalytics({ measurementId: "invalid", consent: "granted" })).toBe(false);
  });
});
