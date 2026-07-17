// Pure, role-aware admin navigation model (plan 076). Data only: no React,
// no Next hooks, no DB — icons are string keys the shell maps to Lucide
// components. Node Vitest exercises sections and active matching directly.
import { copy, type Locale } from "@/lib/i18n";
import { getAdminCopy } from "@/lib/admin-copy";

export type AdminNavIcon =
  | "dashboard"
  | "pen"
  | "tv"
  | "messages"
  | "gamepad"
  | "chart"
  | "users"
  | "handshake"
  | "radio"
  | "key"
  | "shield"
  | "clipboard"
  | "activity"
  | "image"
  | "calendar";

export type AdminNavItem = {
  href: string;
  label: string;
  icon: AdminNavIcon;
  exact?: boolean;
};

export type AdminNavSection = {
  title: string;
  items: AdminNavItem[];
};

export function adminNavSections(
  locale: Locale,
  isSuper: boolean,
  canManageGamePosts: boolean,
  canManageMediaPosts: boolean,
): AdminNavSection[] {
  const t = getAdminCopy(locale).dashboard;
  const workspaceItems: AdminNavItem[] = [
    { href: "/admin", label: t.title, icon: "dashboard", exact: true },
  ];
  if (canManageGamePosts) {
    workspaceItems.push({ href: "/admin/news/new", label: t.quickNewPost, icon: "pen", exact: true });
  }
  if (canManageMediaPosts) {
    workspaceItems.push({
      href: "/admin/news/new/media",
      label: t.quickNewMediaPost,
      icon: "tv",
      exact: true,
    });
  }
  if (canManageGamePosts || canManageMediaPosts) {
    workspaceItems.push({
      href: "/admin/graphics",
      label: locale === "ar" ? "\u0645\u0648\u0644\u062f \u0627\u0644\u0631\u0633\u0648\u0645" : "Graphics generator",
      icon: "image",
    });
    workspaceItems.push({
      href: "/admin/calendar",
      label: t.links.calendarTitle,
      icon: "calendar",
    });
  }
  workspaceItems.push({ href: "/admin/comments", label: t.links.commentsTitle, icon: "messages" });

  const sections: AdminNavSection[] = [
    { title: t.workspaceTitle, items: workspaceItems },
    {
      title: copy[locale].common.content,
      items: [
        { href: "/admin/games", label: t.links.gamesTitle, icon: "gamepad" },
        { href: "/admin/media", label: t.links.mediaTitle, icon: "tv" },
      ],
    },
  ];

  // MCP keys are visible to every approved admin; the rest of System is
  // super-only.
  const systemItems: AdminNavItem[] = [
    {
      href: "/admin/mcp",
      label: locale === "ar" ? "مفاتيح MCP" : "MCP keys",
      icon: "key",
    },
  ];
  if (isSuper) {
    systemItems.unshift(
      { href: "/admin/analytics", label: t.links.analyticsTitle, icon: "chart" },
      { href: "/admin/predictions", label: locale === "ar" ? "عمليات التوقعات" : "Prediction operations", icon: "clipboard" },
      { href: "/admin/users", label: t.links.usersTitle, icon: "users" },
      { href: "/admin/partners", label: t.links.partnersTitle, icon: "handshake" },
      { href: "/admin/streams", label: t.links.streamsTitle, icon: "radio" },
      { href: "/admin/source-health", label: locale === "ar" ? "\u0635\u062d\u0629 \u0627\u0644\u0645\u0635\u0627\u062f\u0631" : "Source health", icon: "activity" },
    );
    systemItems.push(
      { href: "/admin/team", label: t.links.teamTitle, icon: "shield" },
      { href: "/admin/audit", label: t.links.auditTitle, icon: "clipboard" },
    );
  }
  sections.push({
    title: locale === "ar" ? "النظام" : "System",
    items: systemItems,
  });

  return sections;
}

export function isActiveAdminPath(pathname: string, item: Pick<AdminNavItem, "href" | "exact">) {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
