import { describe, expect, test } from "vitest";
import { guardedAdminNavigationHref } from "@/lib/admin-navigation";

const CURRENT = "https://community.example/admin/news/new?draft=1#top";

describe("guardedAdminNavigationHref", () => {
  test("accepts normal same-origin document navigation", () => {
    expect(guardedAdminNavigationHref({
      href: "/admin/comments",
      currentUrl: CURRENT,
    })).toBe("/admin/comments");
    expect(guardedAdminNavigationHref({
      href: "https://community.example/admin/games?page=2#list",
      currentUrl: CURRENT,
    })).toBe("/admin/games?page=2#list");
    expect(guardedAdminNavigationHref({
      href: "/admin/media",
      currentUrl: CURRENT,
      target: "_self",
    })).toBe("/admin/media");
  });

  test("rejects modified and non-primary clicks", () => {
    for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
      expect(guardedAdminNavigationHref({
        href: "/admin/comments",
        currentUrl: CURRENT,
        [modifier]: true,
      })).toBeNull();
    }
    expect(guardedAdminNavigationHref({
      href: "/admin/comments",
      currentUrl: CURRENT,
      button: 1,
    })).toBeNull();
  });

  test("rejects links that should stay outside client navigation", () => {
    expect(guardedAdminNavigationHref({
      href: "/admin/comments",
      currentUrl: CURRENT,
      download: true,
    })).toBeNull();
    expect(guardedAdminNavigationHref({
      href: "/admin/comments",
      currentUrl: CURRENT,
      target: "_blank",
    })).toBeNull();
    expect(guardedAdminNavigationHref({
      href: "mailto:team@example.com",
      currentUrl: CURRENT,
    })).toBeNull();
    expect(guardedAdminNavigationHref({
      href: "tel:+15555550123",
      currentUrl: CURRENT,
    })).toBeNull();
    expect(guardedAdminNavigationHref({
      href: "javascript:alert(1)",
      currentUrl: CURRENT,
    })).toBeNull();
    expect(guardedAdminNavigationHref({
      href: "https://other.example/admin",
      currentUrl: CURRENT,
    })).toBeNull();
  });

  test("rejects same-page hash movement", () => {
    expect(guardedAdminNavigationHref({
      href: "#body",
      currentUrl: CURRENT,
    })).toBeNull();
    expect(guardedAdminNavigationHref({
      href: "/admin/news/new?draft=1#body",
      currentUrl: CURRENT,
    })).toBeNull();
  });
});
