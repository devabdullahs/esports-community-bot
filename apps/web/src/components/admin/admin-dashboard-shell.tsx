"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3Icon,
  ClipboardListIcon,
  Gamepad2Icon,
  HandshakeIcon,
  HomeIcon,
  LayoutDashboardIcon,
  MenuIcon,
  MessagesSquareIcon,
  PenLineIcon,
  RadioIcon,
  ShieldIcon,
  Tv2Icon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { copy, type Locale } from "@/lib/i18n";
import { getAdminCopy } from "@/lib/admin-copy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type AdminNavItem = {
  href: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  exact?: boolean;
};

type AdminNavSection = {
  title: string;
  items: AdminNavItem[];
};

function navSections(
  locale: Locale,
  isSuper: boolean,
  canManageGamePosts: boolean,
  canManageMediaPosts: boolean,
): AdminNavSection[] {
  const t = getAdminCopy(locale).dashboard;
  const workspaceItems: AdminNavItem[] = [
    {
      href: "/admin",
      label: t.title,
      description: t.description,
      icon: LayoutDashboardIcon,
      exact: true,
    },
  ];
  if (canManageGamePosts) {
    workspaceItems.push({
      href: "/admin/news/new",
      label: t.quickNewPost,
      description: t.newsDescription,
      icon: PenLineIcon,
      exact: true,
    });
  }
  if (canManageMediaPosts) {
    workspaceItems.push({
      href: "/admin/news/new/media",
      label: t.quickNewMediaPost,
      description: t.quickNewMediaPostDescription,
      icon: Tv2Icon,
      exact: true,
    });
  }
  workspaceItems.push({
    href: "/admin/comments",
    label: t.links.commentsTitle,
    description: t.links.commentsDescription,
    icon: MessagesSquareIcon,
  });

  const sections: AdminNavSection[] = [
    {
      title: t.workspaceTitle,
      items: workspaceItems,
    },
    {
      title: copy[locale].common.content,
      items: [
        {
          href: "/admin/games",
          label: t.links.gamesTitle,
          description: t.links.gamesDescription,
          icon: Gamepad2Icon,
        },
        {
          href: "/admin/media",
          label: t.links.mediaTitle,
          description: t.links.mediaDescription,
          icon: Tv2Icon,
        },
      ],
    },
  ];

  if (isSuper) {
    sections.push({
      title: locale === "ar" ? "\u0627\u0644\u0646\u0638\u0627\u0645" : "System",
      items: [
        {
          href: "/admin/analytics",
          label: t.links.analyticsTitle,
          description: t.links.analyticsDescription,
          icon: BarChart3Icon,
        },
        {
          href: "/admin/users",
          label: t.links.usersTitle,
          description: t.links.usersDescription,
          icon: UsersIcon,
        },
        {
          href: "/admin/partners",
          label: t.links.partnersTitle,
          description: t.links.partnersDescription,
          icon: HandshakeIcon,
        },
        {
          href: "/admin/streams",
          label: t.links.streamsTitle,
          description: t.links.streamsDescription,
          icon: RadioIcon,
        },
        {
          href: "/admin/team",
          label: t.links.teamTitle,
          description: t.links.teamDescription,
          icon: ShieldIcon,
        },
        {
          href: "/admin/audit",
          label: t.links.auditTitle,
          description: t.links.auditDescription,
          icon: ClipboardListIcon,
        },
      ],
    });
  }

  return sections;
}

function isActivePath(pathname: string, item: AdminNavItem) {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function AdminNavigation({
  locale,
  isSuper,
  canManageGamePosts,
  canManageMediaPosts,
  onNavigate,
}: {
  locale: Locale;
  isSuper: boolean;
  canManageGamePosts: boolean;
  canManageMediaPosts: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const sections = navSections(
    locale,
    isSuper,
    canManageGamePosts,
    canManageMediaPosts,
  );

  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-2">
      {sections.map((section) => (
        <div key={section.title} className="flex flex-col gap-1 py-2">
          <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
            {section.title}
          </p>
          {section.items.map((item) => {
            const active = isActivePath(pathname, item);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                    : "text-muted-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function AdminBreadcrumb({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  const t = getAdminCopy(locale).dashboard;
  const sections = navSections(locale, true, true, true);
  const activeItem =
    sections
      .flatMap((section) => section.items)
      .sort((a, b) => b.href.length - a.href.length)
      .find((item) => isActivePath(pathname, item)) ?? sections[0]?.items[0];

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem className="hidden md:block">
          <BreadcrumbLink href="/admin">{t.title}</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator className="hidden md:block" />
        <BreadcrumbItem>
          <BreadcrumbPage>{activeItem?.label ?? t.title}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

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
  const [mobileOpen, setMobileOpen] = useState(false);
  const common = copy[locale].common;
  const dashboard = getAdminCopy(locale).dashboard;
  const side = locale === "ar" ? "right" : "left";

  return (
    <div className="flex min-h-svh bg-background">
      <aside className="sticky top-0 hidden h-svh w-72 shrink-0 border-e border-border bg-card/60 lg:flex lg:flex-col">
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-4">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldIcon className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold">{common.brand}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {common.admin}
            </span>
          </span>
        </div>
        <AdminNavigation
          locale={locale}
          isSuper={isSuper}
          canManageGamePosts={canManageGamePosts}
          canManageMediaPosts={canManageMediaPosts}
        />
        <div className="border-t border-border p-3">
          <Button
            render={<Link href="/" />}
            nativeButton={false}
            variant="outline"
            className="w-full justify-start"
          >
            <HomeIcon data-icon="inline-start" />
            {common.home}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur supports-backdrop-filter:bg-background/80 sm:px-6">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  aria-label={common.menu}
                />
              }
            >
              <MenuIcon />
            </SheetTrigger>
            <SheetContent
              side={side}
              className="w-[20rem] max-w-[85vw] gap-0 p-0"
              showCloseButton
            >
              <SheetHeader className="border-b border-border px-4 py-4">
                <SheetTitle>{common.admin}</SheetTitle>
                <SheetDescription>{dashboard.description}</SheetDescription>
              </SheetHeader>
              <AdminNavigation
                locale={locale}
                isSuper={isSuper}
                canManageGamePosts={canManageGamePosts}
                canManageMediaPosts={canManageMediaPosts}
                onNavigate={() => setMobileOpen(false)}
              />
            </SheetContent>
          </Sheet>

          <Separator orientation="vertical" className="hidden h-4 lg:block" />
          <AdminBreadcrumb locale={locale} />
          <div className="ms-auto flex min-w-0 items-center gap-2">
            <Badge variant={isSuper ? "default" : "secondary"} className="hidden sm:inline-flex">
              {roleLabel}
            </Badge>
            {displayName ? (
              <span className="hidden max-w-40 truncate text-sm text-muted-foreground md:block">
                {displayName}
              </span>
            ) : null}
          </div>
        </header>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
