"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ActivityIcon,
  BarChart3Icon,
  ClipboardListIcon,
  Gamepad2Icon,
  HandshakeIcon,
  HomeIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  MessagesSquareIcon,
  PenLineIcon,
  RadioIcon,
  ShieldIcon,
  Tv2Icon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { copy, localizedPath, stripLocalePrefix, type Locale } from "@/lib/i18n";
import {
  adminNavSections,
  isActiveAdminPath,
  type AdminNavIcon,
} from "@/lib/admin-navigation-model";
import { AdminNavigationGuardProvider } from "@/components/admin/admin-navigation-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";

const NAV_ICONS: Record<AdminNavIcon, LucideIcon> = {
  dashboard: LayoutDashboardIcon,
  pen: PenLineIcon,
  tv: Tv2Icon,
  messages: MessagesSquareIcon,
  gamepad: Gamepad2Icon,
  chart: BarChart3Icon,
  users: UsersIcon,
  handshake: HandshakeIcon,
  radio: RadioIcon,
  key: KeyRoundIcon,
  shield: ShieldIcon,
  clipboard: ClipboardListIcon,
  activity: ActivityIcon,
};

export function AdminDashboardShell({
  children,
  locale,
  isSuper,
  canManageGamePosts,
  canManageMediaPosts,
  displayName,
  roleLabel,
}: {
  children: ReactNode;
  locale: Locale;
  isSuper: boolean;
  canManageGamePosts: boolean;
  canManageMediaPosts: boolean;
  displayName: string | null;
  roleLabel: string;
}) {
  const pathname = usePathname();
  const common = copy[locale].common;
  const sections = adminNavSections(locale, isSuper, canManageGamePosts, canManageMediaPosts);
  const side = locale === "ar" ? "right" : "left";

  return (
    <AdminNavigationGuardProvider locale={locale}>
      <SidebarProvider>
        <Sidebar
          side={side}
          collapsible="icon"
          style={{ top: "4rem", height: "calc(100svh - 4rem)" }}
        >
          <SidebarHeader>
            <div className="flex w-full items-center gap-2 px-1 py-1.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <ShieldIcon className="size-4" />
              </span>
              <span className="min-w-0 group-data-[collapsible=icon]:hidden">
                <span className="block truncate text-sm font-semibold">{common.brand}</span>
                <span className="block truncate text-xs text-muted-foreground">{common.admin}</span>
              </span>
              <SidebarTrigger aria-label={common.menu} className="ms-auto md:hidden" />
            </div>
          </SidebarHeader>
          <SidebarContent>
            {sections.map((section) => (
              <SidebarGroup key={section.title}>
                <SidebarGroupLabel>{section.title}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {section.items.map((item) => {
                      const Icon = NAV_ICONS[item.icon];
                      const active = isActiveAdminPath(stripLocalePrefix(pathname), item);
                      const href = localizedPath(item.href, locale);
                      return (
                        <SidebarMenuItem key={item.href}>
                          <SidebarMenuButton
                            render={
                              <Link href={href} aria-current={active ? "page" : undefined} />
                            }
                            isActive={active}
                            tooltip={{
                              children: item.label,
                              side: side === "right" ? "left" : "right",
                            }}
                          >
                            <Icon />
                            <span>{item.label}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href={localizedPath("/", locale)} />}
                  tooltip={common.home}
                >
                  <HomeIcon />
                  <span>{common.home}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>
        <SidebarInset>
          <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur supports-backdrop-filter:bg-background/80 sm:px-6">
            <SidebarTrigger aria-label={common.menu} className="-ms-1.5" />
            <div className="ms-auto flex min-w-0 items-center gap-2">
              <Badge variant={isSuper ? "default" : "secondary"} className="hidden sm:inline-flex">
                {roleLabel}
              </Badge>
              {displayName ? (
                <span className="hidden max-w-40 truncate text-sm text-muted-foreground md:block">
                  {displayName}
                </span>
              ) : null}
              <Button
                render={<Link href={localizedPath("/", locale)} />}
                nativeButton={false}
                variant="ghost"
                size="icon-sm"
                className="sm:hidden"
                aria-label={common.home}
              >
                <HomeIcon />
              </Button>
            </div>
          </header>
          <div className="min-w-0 flex-1">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </AdminNavigationGuardProvider>
  );
}
