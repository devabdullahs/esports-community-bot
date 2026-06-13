import { describe, expect, test } from "vitest";
import { isActivePath } from "@/lib/nav";

describe("isActivePath", () => {
  test("exact match is active", () => {
    expect(isActivePath("/games", "/games")).toBe(true);
  });

  test("nested route highlights its section", () => {
    expect(isActivePath("/games/cs2", "/games")).toBe(true);
    expect(isActivePath("/games/cs2/news/4", "/games")).toBe(true);
  });

  test("sibling section is not active", () => {
    expect(isActivePath("/news", "/games")).toBe(false);
  });

  test("prefix that is not a path segment is not active", () => {
    // /gamespage should not match /games
    expect(isActivePath("/gamespage", "/games")).toBe(false);
  });

  test("home only matches exactly", () => {
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/games", "/")).toBe(false);
  });
});
