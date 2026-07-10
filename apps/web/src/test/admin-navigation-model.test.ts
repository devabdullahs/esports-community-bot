import { describe, expect, test } from "vitest";
import { adminNavSections, isActiveAdminPath } from "@/lib/admin-navigation-model";

function allHrefs(sections: ReturnType<typeof adminNavSections>) {
  return sections.flatMap((section) => section.items.map((item) => item.href));
}

describe("admin navigation model", () => {
  test("super admins see every section and item", () => {
    const hrefs = allHrefs(adminNavSections("en", true, true, true));
    for (const href of [
      "/admin",
      "/admin/news/new",
      "/admin/news/new/media",
      "/admin/comments",
      "/admin/games",
      "/admin/media",
      "/admin/analytics",
      "/admin/users",
      "/admin/partners",
      "/admin/streams",
      "/admin/mcp",
      "/admin/team",
      "/admin/audit",
    ]) {
      expect(hrefs).toContain(href);
    }
  });

  test("scoped admins never see super-only entries but keep MCP keys", () => {
    const hrefs = allHrefs(adminNavSections("en", false, true, true));
    for (const href of ["/admin/analytics", "/admin/users", "/admin/partners", "/admin/streams", "/admin/team", "/admin/audit"]) {
      expect(hrefs).not.toContain(href);
    }
    expect(hrefs).toContain("/admin/mcp");
  });

  test("posting shortcuts follow game/media permissions", () => {
    const neither = allHrefs(adminNavSections("en", false, false, false));
    expect(neither).not.toContain("/admin/news/new");
    expect(neither).not.toContain("/admin/news/new/media");
    const gameOnly = allHrefs(adminNavSections("en", false, true, false));
    expect(gameOnly).toContain("/admin/news/new");
    expect(gameOnly).not.toContain("/admin/news/new/media");
  });

  test("active matching: exact /admin and nested dynamic routes", () => {
    const sections = adminNavSections("en", true, true, true);
    const items = sections.flatMap((section) => section.items);
    const dashboard = items.find((item) => item.href === "/admin")!;
    const games = items.find((item) => item.href === "/admin/games")!;
    const newPost = items.find((item) => item.href === "/admin/news/new")!;

    expect(isActiveAdminPath("/admin", dashboard)).toBe(true);
    expect(isActiveAdminPath("/admin/games", dashboard)).toBe(false);
    expect(isActiveAdminPath("/admin/games", games)).toBe(true);
    expect(isActiveAdminPath("/admin/games/valorant", games)).toBe(true);
    expect(isActiveAdminPath("/admin/gamesx", games)).toBe(false);
    expect(isActiveAdminPath("/admin/news/new", newPost)).toBe(true);
    expect(isActiveAdminPath("/admin/news/new/media", newPost)).toBe(false);
  });

  test("labels are localized in both languages", () => {
    const en = adminNavSections("en", true, true, true);
    const ar = adminNavSections("ar", true, true, true);
    expect(en.length).toBe(ar.length);
    const enLabels = en.flatMap((section) => section.items.map((item) => item.label));
    const arLabels = ar.flatMap((section) => section.items.map((item) => item.label));
    expect(enLabels.length).toBe(arLabels.length);
    // Arabic labels must actually differ (contain Arabic script) for the
    // localized entries.
    expect(arLabels.some((label) => /[؀-ۿ]/.test(label))).toBe(true);
    expect(enLabels.every((label) => label.trim().length > 0)).toBe(true);
  });

  test("every item carries an icon key", () => {
    for (const section of adminNavSections("ar", true, true, true)) {
      for (const item of section.items) {
        expect(item.icon).toBeTruthy();
      }
    }
  });
});
