import Link from "next/link";
import { MailIcon, TrophyIcon } from "lucide-react";
import { DiscordIcon } from "@/components/discord-icon";
import { GoogleAnalyticsSettingsButton } from "@/components/analytics/google-analytics-consent";
import { PartnerPlacement } from "@/components/partners/partner-placement";
import { Button } from "@/components/ui/button";
import { CONTACT_EMAIL, DISCORD_INVITE_URL } from "@/lib/community-links";
import { copy, localizedPath } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";

export async function SiteFooter({ analyticsConsentEnabled = false }: { analyticsConsentEnabled?: boolean }) {
  const locale = await getRequestLocale();
  const text = copy[locale];
  const t = text.footer;
  const year = new Date().getFullYear();

  const explore = [
    { href: "/live", label: text.common.live },
    { href: "/games", label: text.common.games },
    { href: "/news", label: text.common.news },
    { href: "/media", label: text.common.media },
    { href: "/predictions", label: text.common.predictions },
  ];
  const about = [
    { href: "/partners", label: text.common.partners },
    { href: "/docs/mcp", label: t.mcpDocs },
    { href: "/terms", label: text.common.termsOfService },
    { href: "/privacy", label: text.common.privacyPolicy },
  ];

  return (
    <footer className="border-t bg-muted/20">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-8">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div className="flex flex-col gap-3 sm:col-span-2 lg:col-span-1">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-foreground">
                <TrophyIcon className="size-4" />
              </span>
              <p className="text-sm font-semibold text-foreground">{text.common.brand}</p>
            </div>
            <p className="max-w-xs text-sm leading-6 text-muted-foreground">{t.note}</p>
            <Button
              render={<a href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer" />}
              nativeButton={false}
              variant="outline"
              size="sm"
              className="mt-1 w-fit"
            >
              <DiscordIcon data-icon="inline-start" />
              {text.common.joinDiscord}
            </Button>
          </div>

          {/* Explore */}
          <FooterColumn heading={t.explore}>
            {explore.map((link) => (
              <FooterLink key={link.href} href={localizedPath(link.href, locale)} label={link.label} />
            ))}
          </FooterColumn>

          {/* About */}
          <FooterColumn heading={t.about}>
            {about.map((link) => (
              <FooterLink key={link.href} href={localizedPath(link.href, locale)} label={link.label} />
            ))}
            {analyticsConsentEnabled ? <GoogleAnalyticsSettingsButton locale={locale} /> : null}
          </FooterColumn>

          {/* Contact */}
          <FooterColumn heading={t.contact}>
            <p className="max-w-52 text-sm leading-6 text-muted-foreground">{t.contactHint}</p>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <MailIcon className="size-3.5" />
              {CONTACT_EMAIL}
            </a>
            <a
              href={DISCORD_INVITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <DiscordIcon className="size-3.5" />
              {text.common.joinDiscord}
            </a>
          </FooterColumn>
        </div>

        <PartnerPlacement kind="footer" locale={locale} />

        <div className="flex flex-col-reverse items-start justify-between gap-2 border-t pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <p>
            © {year} {t.brand}. {t.rights}
          </p>
          <p className="inline-flex items-center gap-1.5 font-medium text-foreground/80">
            {t.madeIn}
            <span aria-hidden className="text-sm leading-none">🇸🇦</span>
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-xs font-semibold uppercase text-foreground/70 rtl:normal-case">{heading}</p>
      {children}
    </div>
  );
}

function FooterLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="w-fit text-sm text-muted-foreground transition-colors hover:text-foreground">
      {label}
    </Link>
  );
}
