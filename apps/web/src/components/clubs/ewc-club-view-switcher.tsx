import Link from "next/link";
import { LayoutGridIcon, ListOrderedIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copy, localizedPath, type Locale } from "@/lib/i18n";

export function EwcClubViewSwitcher({
  locale,
  active,
}: {
  locale: Locale;
  active: "directory" | "standings";
}) {
  const text = copy[locale].ewcClubs;
  const views = [
    {
      id: "directory" as const,
      href: "/clubs",
      label: text.directoryTab,
      icon: LayoutGridIcon,
    },
    {
      id: "standings" as const,
      href: "/clubs/standings",
      label: text.standingsTab,
      icon: ListOrderedIcon,
    },
  ];

  return (
    <nav aria-label={text.viewLabel} className="w-fit max-w-full rounded-lg bg-muted p-1">
      <div className="flex max-w-full gap-1 overflow-x-auto">
        {views.map(({ id, href, label, icon: Icon }) => (
          <Button
            key={id}
            render={
              <Link
                href={localizedPath(href, locale)}
                aria-current={active === id ? "page" : undefined}
              />
            }
            nativeButton={false}
            variant={active === id ? "secondary" : "ghost"}
            size="sm"
            className="shrink-0"
          >
            <Icon data-icon="inline-start" />
            {label}
          </Button>
        ))}
      </div>
    </nav>
  );
}
