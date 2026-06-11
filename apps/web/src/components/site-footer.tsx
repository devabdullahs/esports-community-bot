import Link from "next/link";
import { TrophyIcon } from "lucide-react";
import { copy, localizedPath } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";

export async function SiteFooter() {
  const locale = await getRequestLocale();
  const text = copy[locale];

  const links = [
    { href: "/games", label: text.common.games },
    { href: "/news", label: text.common.news },
    { href: "/media", label: text.common.media },
    { href: "/predictions", label: text.common.predictions },
  ];

  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-10 sm:px-8">
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-start">
          <div className="flex items-start gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted text-foreground">
              <TrophyIcon className="size-4" />
            </span>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-foreground">{text.common.brand}</p>
              <p className="max-w-xs text-sm text-muted-foreground">{text.footer.note}</p>
            </div>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2">
            {links.map((link) => (
              <Link
                key={link.href}
                href={localizedPath(link.href, locale)}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <p className="text-xs text-muted-foreground">{text.footer.brand}</p>
      </div>
    </footer>
  );
}
