import { describe, expect, test } from "vitest";
import { formatMatchCount } from "@/lib/i18n";

describe("formatMatchCount", () => {
  test("formats English match counts", () => {
    expect(formatMatchCount(0, "en")).toBe("0 matches");
    expect(formatMatchCount(1, "en")).toBe("1 match");
    expect(formatMatchCount(2, "en")).toBe("2 matches");
  });

  test("formats Arabic match counts with the right noun form", () => {
    expect(formatMatchCount(0, "ar")).toBe("\u0644\u0627 \u062a\u0648\u062c\u062f \u0645\u0628\u0627\u0631\u064a\u0627\u062a");
    expect(formatMatchCount(1, "ar")).toBe("\u0645\u0628\u0627\u0631\u0627\u0629 \u0648\u0627\u062d\u062f\u0629");
    expect(formatMatchCount(2, "ar")).toBe("\u0645\u0628\u0627\u0631\u0627\u062a\u0627\u0646");
    expect(formatMatchCount(3, "ar")).toBe("\u0663 \u0645\u0628\u0627\u0631\u064a\u0627\u062a");
    expect(formatMatchCount(10, "ar")).toBe("\u0661\u0660 \u0645\u0628\u0627\u0631\u064a\u0627\u062a");
    expect(formatMatchCount(11, "ar")).toBe("\u0661\u0661 \u0645\u0628\u0627\u0631\u0627\u0629");
    expect(formatMatchCount(25, "ar")).toBe("\u0662\u0665 \u0645\u0628\u0627\u0631\u0627\u0629");
    expect(formatMatchCount(102, "ar")).toBe("\u0661\u0660\u0662 \u0645\u0628\u0627\u0631\u0627\u0629");
  });
});
