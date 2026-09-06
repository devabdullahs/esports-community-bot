import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import type { ReactNode } from "react";

export function SectionHeading({
  title,
  href,
  action,
  children,
  id,
}: {
  title: string;
  href?: string;
  action?: string;
  children?: ReactNode;
  id?: string;
}) {
  return (
    <div className="ec-section-heading">
      <h2 id={id}>
        {title}
        {children}
      </h2>
      {href && action ? (
        <Link href={href} className="ec-text-link">
          {action}
          <ArrowRightIcon
            aria-hidden="true"
            className="size-4 rtl:rotate-180"
          />
        </Link>
      ) : null}
    </div>
  );
}
