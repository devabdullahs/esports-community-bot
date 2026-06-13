import Link from "next/link";
import { Fragment } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export type Crumb = {
  label: string;
  /** Omit for the current page (rendered as plain text, no link). */
  href?: string;
};

// Shared breadcrumb row for inner pages. The last crumb is the current page.
// Direction (and separator chevron flip) is handled by the breadcrumb UI
// component via logical properties + rtl: variants, so this stays locale-free.
export function PageBreadcrumb({ items }: { items: Crumb[] }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <Fragment key={`${item.label}-${index}`}>
              <BreadcrumbItem className="max-w-[16rem] truncate">
                {isLast || !item.href ? (
                  <BreadcrumbPage dir="auto" className="truncate">
                    {item.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    dir="auto"
                    className="truncate"
                    render={<Link href={item.href} />}
                  >
                    {item.label}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {isLast ? null : <BreadcrumbSeparator />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
