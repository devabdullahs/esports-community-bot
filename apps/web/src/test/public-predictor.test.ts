import { describe, expect, test } from "vitest";
import { copy, directionForLocale, localizedPath } from "@/lib/i18n";

const PUBLIC_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("public predictor routes", () => {
  test("uses an opaque predictor route in English", () => {
    expect(localizedPath(`/predictors/${PUBLIC_ID}`, "en")).toBe(`/predictors/${PUBLIC_ID}`);
    expect(copy.en.predictor.title("Falcons fan")).toBe("Falcons fan's prediction profile");
  });

  test("localizes the public predictor route and copy for Arabic RTL", () => {
    expect(localizedPath(`/predictors/${PUBLIC_ID}`, "ar")).toBe(`/ar/predictors/${PUBLIC_ID}`);
    expect(directionForLocale("ar")).toBe("rtl");
    expect(copy.ar.predictor.title("Falcons fan")).toContain("Falcons fan");
    expect(copy.ar.predictor.recentResults).not.toBe(copy.en.predictor.recentResults);
  });
});
