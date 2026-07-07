import { describe, expect, test } from "vitest";
import {
  profileReturnContextFromSearchParams,
  profileReturnSearchParams,
  withProfileReturn,
} from "@/lib/profile-navigation";

describe("profile return navigation", () => {
  test("builds safe return params for internal profile links", () => {
    const params = profileReturnSearchParams({
      type: "tournament",
      href: "/tournaments/123",
      label: "Dota 2 EWC",
    });
    expect(params.get("fromType")).toBe("tournament");
    expect(params.get("fromHref")).toBe("/tournaments/123");
    expect(params.get("fromLabel")).toBe("Dota 2 EWC");
  });

  test("adds return params to localized profile links", () => {
    expect(
      withProfileReturn("/teams/7", "ar", {
        type: "tournament",
        href: "/tournaments/123",
        label: "Dota 2 EWC",
      }),
    ).toBe("/ar/teams/7?fromType=tournament&fromHref=%2Ftournaments%2F123&fromLabel=Dota+2+EWC");
  });

  test("rejects unsafe or self-referential return contexts", () => {
    expect(
      profileReturnContextFromSearchParams({
        fromType: "team",
        fromHref: "https://example.com",
        fromLabel: "Example",
      }),
    ).toBeNull();
    expect(
      profileReturnContextFromSearchParams(
        { fromType: "team", fromHref: "/teams/7", fromLabel: "Team Alpha" },
        { currentPath: "/teams/7" },
      ),
    ).toBeNull();
  });
});
