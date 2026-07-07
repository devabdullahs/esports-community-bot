import { describe, expect, test } from "vitest";
import { canonicalPublicAssetUrl, safeUrlOrUndefined } from "@/lib/safe-url";

describe("canonicalPublicAssetUrl", () => {
  test("rewrites legacy public asset uploads to the Esports Community host", () => {
    expect(
      canonicalPublicAssetUrl("https://assets.moonbot.info/news/2026-07-02/cover.jpg?size=large#preview"),
    ).toBe("https://assets.esportscommunity.net/news/2026-07-02/cover.jpg?size=large#preview");
  });

  test("leaves unrelated safe URLs unchanged apart from trimming", () => {
    expect(canonicalPublicAssetUrl(" https://cdn.example.test/image.jpg ")).toBe("https://cdn.example.test/image.jpg");
  });
});

describe("safeUrlOrUndefined", () => {
  test("canonicalizes legacy asset URLs after scheme validation", () => {
    expect(safeUrlOrUndefined("https://assets.moonbot.info/news/cover.jpg")).toBe(
      "https://assets.esportscommunity.net/news/cover.jpg",
    );
  });

  test("still rejects unsafe URL schemes", () => {
    expect(safeUrlOrUndefined("javascript:alert(1)")).toBeUndefined();
  });
});
