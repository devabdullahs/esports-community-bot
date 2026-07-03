import Link from "next/link";
import { TrophyIcon } from "lucide-react";
import { DiscordIcon } from "@/components/discord-icon";
import { PartnerPlacement } from "@/components/partners/partner-placement";
import { Button } from "@/components/ui/button";
import { DISCORD_INVITE_URL } from "@/lib/community-links";
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
    { href: "/partners", label: text.common.partners },
    { href: "/terms", label: text.common.termsOfService },
    { href: "/privacy", label: text.common.privacyPolicy },
  ];

  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-8 sm:py-10">
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-start">
          <div className="flex items-start gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted text-foreground">
              <TrophyIcon className="size-4" />
            </span>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-foreground">{text.common.brand}</p>
              <p className="max-w-xs text-sm text-muted-foreground">{text.footer.note}</p>
              <Button
                render={
                  <a
                    href={DISCORD_INVITE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
                nativeButton={false}
                variant="outline"
                size="sm"
                className="mt-2 w-fit"
              >
                <DiscordIcon data-icon="inline-start" />
                {text.common.joinDiscord}
              </Button>
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
        <PartnerPlacement kind="footer" locale={locale} />
        <p className="text-xs text-muted-foreground">{text.footer.brand}</p>
      </div>
    </footer>
  );
}
