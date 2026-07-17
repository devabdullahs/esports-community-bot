import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { localizedPath } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";
import { cn } from "@/lib/utils";
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

const maxWidthClasses = {
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
  full: "max-w-none",
} as const;

// Page-owned hierarchy: each server page supplies its real entity labels.
// The final crumb is the current page; preceding crumbs link upward.
export type AdminCrumb = { label: string; href?: string };

export async function AdminPageShell({
  breadcrumbs,
  backHref,
  backLabel,
  eyebrow,
  title,
  description,
  badge,
  actions,
  children,
  maxWidth = "4xl",
}: {
  breadcrumbs?: AdminCrumb[];
  backHref?: string;
  backLabel?: string;
  eyebrow?: string;
  title: string;
  description?: string;
  badge?: string;
  actions?: ReactNode;
  children: ReactNode;
  maxWidth?: keyof typeof maxWidthClasses;
}) {
  const locale = await getRequestLocale();
  const hrefForLocale = (href: string) => localizedPath(href, locale);
  // The back action derives from the nearest preceding linked crumb so the
  // two can never disagree; explicit backHref/backLabel is the fallback for
  // pages without breadcrumbs.
  const parentCrumb = breadcrumbs
    ? [...breadcrumbs.slice(0, -1)].reverse().find((crumb) => crumb.href)
    : undefined;
  const back = parentCrumb
    ? { href: parentCrumb.href!, label: parentCrumb.label }
    : backHref && backLabel
      ? { href: backHref, label: backLabel }
      : null;

  return (
    <main
      className={cn(
        "mx-auto flex w-full flex-1 flex-col gap-5 px-4 py-5 sm:gap-6 sm:px-6 sm:py-6",
        maxWidthClasses[maxWidth],
      )}
    >
      <header className="flex flex-col gap-2">
        {breadcrumbs?.length || back ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {back ? (
              <Button
                render={<Link href={hrefForLocale(back.href)} />}
                nativeButton={false}
                variant="ghost"
                size="sm"
                className="-ms-2 w-fit text-muted-foreground hover:text-foreground"
              >
                <ArrowLeftIcon data-icon="inline-start" className="rtl:rotate-180" />
                {back.label}
              </Button>
            ) : null}
            {breadcrumbs?.length ? (
              <Breadcrumb>
                <BreadcrumbList>
                  {breadcrumbs.map((crumb, index) => {
                    const isLast = index === breadcrumbs.length - 1;
                    return (
                      <Fragment key={`${crumb.label}-${index}`}>
                        <BreadcrumbItem>
                          {isLast || !crumb.href ? (
                            <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                          ) : (
                            <BreadcrumbLink render={<Link href={hrefForLocale(crumb.href)} />}>
                              {crumb.label}
                            </BreadcrumbLink>
                          )}
                        </BreadcrumbItem>
                        {!isLast ? <BreadcrumbSeparator /> : null}
                      </Fragment>
                    );
                  })}
                </BreadcrumbList>
              </Breadcrumb>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col items-start justify-between gap-3 xl:flex-row xl:items-center">
          <div className="min-w-0 flex-1">
            {eyebrow ? (
              <p className="text-xs font-medium tracking-wide text-primary">{eyebrow}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-balance text-xl font-semibold leading-tight sm:text-2xl">
                {title}
              </h1>
              {badge ? <Badge variant="secondary">{badge}</Badge> : null}
            </div>
            {description ? (
              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex w-full shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:w-auto xl:justify-end">
              {actions}
            </div>
          ) : null}
        </div>
      </header>

      {children}
    </main>
  );
}
