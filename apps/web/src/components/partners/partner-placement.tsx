import Link from "next/link";
import { ExternalLinkIcon, HandshakeIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { localizedPath, type Locale } from "@/lib/i18n";
import { listActivePartnerCampaignsCached, type PartnerCampaign } from "@/lib/partners";
import { safeUrlOrUndefined } from "@/lib/safe-url";

type PlacementKind = "homepage" | "footer" | "predictions" | "leaderboard" | "tournament";

const PLACEMENT_COPY = {
  en: {
    sponsor: "Sponsor",
    communityPartner: "Community Partner",
    communityPartners: "Community partners",
    supportNote: "Partner recognition helps cover hosting, development, and future community events.",
    presentedBy: "Presented by",
    coveragePartner: "Coverage partner",
    learnMore: "Learn more",
    becomePartner: "Become a partner",
  },
  ar: {
    sponsor: "راعٍ",
    communityPartner: "شريك المجتمع",
    communityPartners: "شركاء المجتمع",
    supportNote: "يساعد دعم الشركاء في تغطية الاستضافة والتطوير وفعاليات المجتمع المستقبلية.",
    presentedBy: "برعاية",
    coveragePartner: "شريك التغطية",
    learnMore: "المزيد",
    becomePartner: "كن شريكاً",
  },
} as const;

function partnerHref(campaign: PartnerCampaign): string | null {
  return safeUrlOrUndefined(campaign.partner?.websiteUrl) ?? null;
}

function PartnerIdentity({ campaign, locale }: { campaign: PartnerCampaign; locale: Locale }) {
  const t = PLACEMENT_COPY[locale];
  const partner = campaign.partner;
  if (!partner) return null;
  const href = partnerHref(campaign);
  const logo = safeUrlOrUndefined(partner.logoUrl);
  const label = campaign.title || partner.name;
  const body = (
    <span className="flex min-w-0 items-center gap-2">
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- admin-curated http(s) partner logo.
        <img
          src={logo}
          alt=""
          className="size-8 shrink-0 rounded-md border bg-background object-contain p-1"
        />
      ) : (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted">
          <HandshakeIcon />
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold" dir="auto">{label}</span>
        {campaign.note || partner.summary ? (
          <span className="line-clamp-1 text-xs text-muted-foreground" dir="auto">
            {campaign.note || partner.summary}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{t.communityPartner}</span>
        )}
      </span>
    </span>
  );
  if (!href) return body;
  return (
    <a
      href={href}
      target="_blank"
      rel="sponsored nofollow noopener noreferrer"
      className="min-w-0 rounded-md outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-ring"
    >
      {body}
    </a>
  );
}

export async function PartnerPlacement({
  kind,
  target = "",
  locale,
}: {
  kind: PlacementKind;
  target?: string;
  locale: Locale;
}) {
  const limit = kind === "footer" ? 4 : 1;
  const campaigns = await listActivePartnerCampaignsCached({ kind, target, limit });
  if (!campaigns.length) return null;

  const t = PLACEMENT_COPY[locale];

  if (kind === "footer") {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-muted/20 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{t.sponsor}</Badge>
          <span className="text-xs text-muted-foreground">{t.supportNote}</span>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {campaigns.map((campaign) => (
            <PartnerIdentity key={campaign.id} campaign={campaign} locale={locale} />
          ))}
        </div>
      </div>
    );
  }

  if (kind === "homepage") {
    return (
      <section className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card/25 p-4">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant="outline">{t.sponsor}</Badge>
                <h2 className="text-base font-semibold">{t.communityPartners}</h2>
              </div>
              <p className="text-sm text-muted-foreground">{t.supportNote}</p>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              {campaigns.map((campaign) => (
                <PartnerIdentity key={campaign.id} campaign={campaign} locale={locale} />
              ))}
              <Button render={<Link href={localizedPath("/partners", locale)} />} nativeButton={false} size="sm" variant="ghost">
                {t.becomePartner}
              </Button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const campaign = campaigns[0];
  const label =
    kind === "tournament" ? t.coveragePartner : kind === "predictions" || kind === "leaderboard" ? t.presentedBy : t.sponsor;

  return (
    <Card className="border-border/70 bg-card/45 shadow-sm">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <Badge variant="outline" className="w-fit">{label}</Badge>
          <PartnerIdentity campaign={campaign} locale={locale} />
        </div>
        <Button
          render={<Link href={localizedPath("/partners", locale)} />}
          nativeButton={false}
          variant="ghost"
          size="sm"
          className="w-fit"
        >
          {t.learnMore}
          <ExternalLinkIcon data-icon="inline-end" />
        </Button>
      </CardContent>
    </Card>
  );
}

export function partnerPlacementCopy(locale: Locale) {
  return PLACEMENT_COPY[locale];
}
