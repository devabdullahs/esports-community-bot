import { describe, expect, test } from "vitest";

import { matchesMagicBytes } from "@/app/api/admin/news/upload/route";

const bytes = (values: number[]) => new Uint8Array(values);
const ascii = (value: string) => [...value].map((char) => char.charCodeAt(0));

describe("news upload magic-byte checks", () => {
  test("accepts AVIF files with an avif major brand", () => {
    const payload = bytes([0, 0, 0, 24, ...ascii("ftyp"), ...ascii("avif"), 0, 0, 0, 0, ...ascii("mif1")]);

    expect(matchesMagicBytes(payload, "image/avif")).toBe(true);
  });

  test("accepts AVIF files with avif as a compatible brand", () => {
    const payload = bytes([0, 0, 0, 28, ...ascii("ftyp"), ...ascii("mif1"), 0, 0, 0, 0, ...ascii("avif")]);

    expect(matchesMagicBytes(payload, "image/avif")).toBe(true);
  });

  test("rejects non-AVIF ISO-BMFF files", () => {
    const payload = bytes([0, 0, 0, 24, ...ascii("ftyp"), ...ascii("mp42"), 0, 0, 0, 0, ...ascii("mp41")]);

    expect(matchesMagicBytes(payload, "image/avif")).toBe(false);
  });
});
