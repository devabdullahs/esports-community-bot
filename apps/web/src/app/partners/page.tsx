import type { Metadata } from "next";
import { ExternalLinkIcon, HandshakeIcon, TrophyIcon } from "lucide-react";
import { PartnerInquiryForm } from "@/components/partners/partner-inquiry-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { localizedPath } from "@/lib/i18n";
import { buildPageMetadata } from "@/lib/metadata";
import { getRequestLocale } from "@/lib/request-locale";
import { githubSponsorsUrl, listPartners } from "@/lib/partners";
import { safeUrlOrUndefined } from "@/lib/safe-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COPY = {
  en: {
    eyebrow: "Partners",
    title: "Support the open-source community project.",
    description:
      "Partner recognition is curated, clearly labeled, and designed to help cover hosting, development, and future community events without interrupting the site.",
    sponsorGithub: "Sponsor on GitHub",
    activePartners: "Active partners",
    activePartnersDescription: "The brands and creators currently supporting the project.",
    noPartners: "No active partners yet.",
    principlesTitle: "Our commitments",
    formTitle: "Apply to become a community partner",
    formDescription:
      "Tell us what you'd like to support. We review every request by hand and reply with the simplest way to help — usually GitHub Sponsors, or a private option if that suits you better.",
    principles: [
      "No third-party ad network or tracking scripts.",
      "Sponsor links are labeled and use sponsored/nofollow attributes.",
      "Predictions stay free to enter with no paid advantage.",
      "Liquipedia-sourced data remains attributed and ungated.",
    ],
  },
  ar: {
    eyebrow: "الشركاء",
    title: "ادعم مشروع المجتمع مفتوح المصدر.",
    description:
      "ظهور الشركاء منسق وواضح ومصمم للمساعدة في تغطية الاستضافة والتطوير وفعاليات المجتمع المستقبلية دون إزعاج تجربة الموقع.",
    sponsorGithub: "ادعمنا عبر GitHub",
    activePartners: "الشركاء النشطون",
    activePartnersDescription: "العلامات والصنّاع الذين يدعمون المشروع حالياً.",
    noPartners: "لا يوجد شركاء نشطون حالياً.",
    principlesTitle: "التزاماتنا",
    formTitle: "قدّم طلبك لتصبح شريكاً للمجتمع",
    formDescription:
      "أخبرنا بما ترغب بدعمه. نراجع كل طلب بأنفسنا ونردّ عليك بأبسط طريقة للمساهمة — غالباً عبر GitHub Sponsors أو بخيار خاص إن كان أنسب لك.",
    principles: [
      "لا توجد شبكات إعلانية خارجية أو سكربتات تتبع.",
      "روابط الشركاء واضحة وتستخدم سمات sponsored/nofollow.",
      "التوقعات تبقى مجانية دون أفضلية مدفوعة.",
      "بيانات Liquipedia تبقى منسوبة وغير مقيدة.",
    ],
  },
} as const;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const text = COPY[locale];
  return buildPageMetadata({
    title: text.eyebrow,
    description: text.description,
    path: localizedPath("/partners", locale),
    locale,
  });
}

export default async function PartnersPage() {
  const locale = await getRequestLocale();
  const t = COPY[locale];
  const partners = await listPartners({ activeOnly: true });
  const sponsorsUrl = githubSponsorsUrl();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8 sm:px-8 sm:py-10">
      <section className="flex max-w-3xl flex-col items-start gap-4">
        <Badge variant="outline">
          <HandshakeIcon data-icon="inline-start" />
          {t.eyebrow}
        </Badge>
        <h1 className="text-3xl font-semibold leading-tight text-balance sm:text-4xl">{t.title}</h1>
        <p className="text-sm leading-6 text-muted-foreground sm:text-base">{t.description}</p>
        <Button render={<a href={sponsorsUrl} target="_blank" rel="noopener noreferrer" />} nativeButton={false} variant="outline">
          <ExternalLinkIcon data-icon="inline-start" />
          {t.sponsorGithub}
        </Button>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{t.activePartners}</CardTitle>
              <CardDescription>{t.activePartnersDescription}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {partners.length ? (
                partners.map((partner) => {
                  const logo = safeUrlOrUndefined(partner.logoUrl);
                  const href = safeUrlOrUndefined(partner.websiteUrl);
                  const inner = (
                    <span className="flex min-w-0 items-center gap-3 rounded-xl border bg-muted/20 p-3">
                      {logo ? (
                        // eslint-disable-next-line @next/next/no-img-element -- admin-curated http(s) partner logo.
                        <img src={logo} alt="" className="size-10 shrink-0 rounded-lg border bg-background object-contain p-1" />
                      ) : (
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background">
                          <TrophyIcon />
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate font-semibold" dir="auto">{partner.name}</span>
                        {partner.summary ? (
                          <span className="line-clamp-2 text-sm text-muted-foreground" dir="auto">{partner.summary}</span>
                        ) : null}
                      </span>
                    </span>
                  );
                  return href ? (
                    <a key={partner.id} href={href} target="_blank" rel="sponsored nofollow noopener noreferrer">
                      {inner}
                    </a>
                  ) : (
                    <span key={partner.id}>{inner}</span>
                  );
                })
              ) : (
                <p className="text-sm text-muted-foreground">{t.noPartners}</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t.principlesTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex list-disc flex-col gap-2 ps-5 text-sm leading-6 text-muted-foreground">
                {t.principles.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-xl font-semibold">{t.formTitle}</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{t.formDescription}</p>
          </div>
          <PartnerInquiryForm locale={locale} />
        </section>
      </section>
    </main>
  );
}
