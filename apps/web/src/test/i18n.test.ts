import { describe, expect, test } from "vitest";
import { formatMatchCount, formatMatchStatusCount } from "@/lib/i18n";

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

describe("formatMatchStatusCount", () => {
  test("formats English live and upcoming match counts", () => {
    expect(formatMatchStatusCount(0, "live", "en")).toBe("No live matches");
    expect(formatMatchStatusCount(1, "live", "en")).toBe("1 live match");
    expect(formatMatchStatusCount(2, "upcoming", "en")).toBe("2 upcoming matches");
  });

  test("formats Arabic live match counts as one grammatical phrase", () => {
    expect(formatMatchStatusCount(0, "live", "ar")).toBe("\u0644\u0627 \u062a\u0648\u062c\u062f \u0645\u0628\u0627\u0631\u064a\u0627\u062a \u0645\u0628\u0627\u0634\u0631\u0629");
    expect(formatMatchStatusCount(1, "live", "ar")).toBe("\u0645\u0628\u0627\u0631\u0627\u0629 \u0648\u0627\u062d\u062f\u0629 \u0645\u0628\u0627\u0634\u0631\u0629");
    expect(formatMatchStatusCount(2, "live", "ar")).toBe("\u0645\u0628\u0627\u0631\u0627\u062a\u0627\u0646 \u0645\u0628\u0627\u0634\u0631\u062a\u0627\u0646");
    expect(formatMatchStatusCount(3, "live", "ar")).toBe("\u0663 \u0645\u0628\u0627\u0631\u064a\u0627\u062a \u0645\u0628\u0627\u0634\u0631\u0629");
    expect(formatMatchStatusCount(11, "live", "ar")).toBe("\u0661\u0661 \u0645\u0628\u0627\u0631\u0627\u0629 \u0645\u0628\u0627\u0634\u0631\u0629");
  });

  test("formats Arabic upcoming match counts as one grammatical phrase", () => {
    expect(formatMatchStatusCount(0, "upcoming", "ar")).toBe("\u0644\u0627 \u062a\u0648\u062c\u062f \u0645\u0628\u0627\u0631\u064a\u0627\u062a \u0642\u0627\u062f\u0645\u0629");
    expect(formatMatchStatusCount(1, "upcoming", "ar")).toBe("\u0645\u0628\u0627\u0631\u0627\u0629 \u0648\u0627\u062d\u062f\u0629 \u0642\u0627\u062f\u0645\u0629");
    expect(formatMatchStatusCount(2, "upcoming", "ar")).toBe("\u0645\u0628\u0627\u0631\u0627\u062a\u0627\u0646 \u0642\u0627\u062f\u0645\u062a\u0627\u0646");
    expect(formatMatchStatusCount(5, "upcoming", "ar")).toBe("\u0665 \u0645\u0628\u0627\u0631\u064a\u0627\u062a \u0642\u0627\u062f\u0645\u0629");
    expect(formatMatchStatusCount(16, "upcoming", "ar")).toBe("\u0661\u0666 \u0645\u0628\u0627\u0631\u0627\u0629 \u0642\u0627\u062f\u0645\u0629");
  });
});
