import { describe, expect, test } from "vitest";
import { clampInt, isSnowflake, isSeason } from "@/lib/validate";

describe("isSnowflake", () => {
  // Valid: 17, 18, 19, 20 digit strings
  test("17-digit string → true", () => expect(isSnowflake("12345678901234567")).toBe(true));
  test("18-digit string → true", () => expect(isSnowflake("123456789012345678")).toBe(true));
  test("19-digit string → true", () => expect(isSnowflake("1234567890123456789")).toBe(true));
  test("20-digit string → true", () => expect(isSnowflake("12345678901234567890")).toBe(true));

  // Invalid lengths
  test("16-digit string → false", () => expect(isSnowflake("1234567890123456")).toBe(false));
  test("21-digit string → false", () => expect(isSnowflake("123456789012345678901")).toBe(false));

  // Non-string inputs
  test("number → false", () => expect(isSnowflake(123456789012345678)).toBe(false));
  test("null → false", () => expect(isSnowflake(null)).toBe(false));
  test("undefined → false", () => expect(isSnowflake(undefined)).toBe(false));
  test("empty string → false", () => expect(isSnowflake("")).toBe(false));

  // Non-digit chars
  test("digits with letters → false", () => expect(isSnowflake("1234567890abcde678")).toBe(false));
});

describe("isSeason", () => {
  test("'2026' → true", () => expect(isSeason("2026")).toBe(true));
  test("'2025' → true", () => expect(isSeason("2025")).toBe(true));

  test("'20x6' → false", () => expect(isSeason("20x6")).toBe(false));
  test("empty string → false", () => expect(isSeason("")).toBe(false));
  test("3-digit string → false", () => expect(isSeason("202")).toBe(false));
  test("5-digit string → false", () => expect(isSeason("20260")).toBe(false));
  test("non-string → false", () => expect(isSeason(2026)).toBe(false));
});

describe("clampInt", () => {
  const opts = { min: 1, max: 100, fallback: 10 };

  test("null → fallback", () => expect(clampInt(null, opts)).toBe(10));
  test("empty string → fallback", () => expect(clampInt("", opts)).toBe(10));
  test("undefined → fallback", () => expect(clampInt(undefined, opts)).toBe(10));
  test("'abc' (NaN) → fallback", () => expect(clampInt("abc", opts)).toBe(10));

  test("'999999' → max (100)", () => expect(clampInt("999999", opts)).toBe(100));
  test("'0' below min → min (1)", () => expect(clampInt("0", opts)).toBe(1));
  test("'25' → 25", () => expect(clampInt("25", opts)).toBe(25));
  test("number 50 → 50", () => expect(clampInt(50, opts)).toBe(50));
  test("float '3.9' → truncated to 3, then clamped to min 1 → 3", () => expect(clampInt("3.9", opts)).toBe(3));
});
