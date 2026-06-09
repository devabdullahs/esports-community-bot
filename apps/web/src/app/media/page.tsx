import Link from "next/link";
import { Tv2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { localizeText } from "@/lib/community-content";
import { directionForLocale, localizedPath } from "@/lib/i18n";
import { listMediaChannels } from "@/lib/media";
import { getRequestLocale } from "@/lib/request-locale";
import { safeUrlOrUndefined } from "@/lib/safe-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COPY = {
  en: {
    eyebrow: "Media",
    title: "Esports media channels",
    description: "The community's media partners and creators — follow them across platforms.",
    empty: "No media channels yet.",
  },
  ar: {
    eyebrow: "الإعلام",
    title: "القنوات الإعلامية",
    description: "شركاء الإعلام وصنّاع المحتوى في المجتمع — تابعهم عبر المنصات.",
    empty: "لا توجد قنوات إعلامية بعد.",
  },
} as const;

export default async function MediaPage() {
  const locale = await getRequestLocale();
  const t = COPY[locale];
  const channels = listMediaChannels();

  return (
    <main
      lang={locale}
      dir={directionForLocale(locale)}
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-5 py-10 sm:px-8"
    >
      <section className="flex max-w-3xl flex-col items-start gap-4">
        <Badge variant="outline">
          <Tv2Icon data-icon="inline-start" />
          {t.eyebrow}
        </Badge>
        <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">{t.title}</h1>
        <p className="text-sm leading-6 text-muted-foreground sm:text-base">{t.description}</p>
      </section>

      {channels.length ? (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {channels.map((channel) => {
            const logo = safeUrlOrUndefined(channel.logoUrl);
            return (
              <Link
                key={channel.slug}
                href={localizedPath(`/media/${channel.slug}`, locale)}
                className="group block"
              >
                <Card
                  size="sm"
                  className="h-full transition-[box-shadow] group-hover:shadow-md group-hover:ring-primary/40"
                >
                  <CardHeader>
                    <div className="mb-2 flex items-center gap-3">
                      {logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={logo} alt="" className="size-10 shrink-0 rounded-md border border-border object-cover" />
                      ) : (
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted">
                          <Tv2Icon />
                        </span>
                      )}
                      <CardTitle>{localizeText(channel.name, locale)}</CardTitle>
                    </div>
                    {localizeText(channel.description, locale) ? (
                      <CardDescription className="line-clamp-2">
                        {localizeText(channel.description, locale)}
                      </CardDescription>
                    ) : null}
                  </CardHeader>
                  {channel.links.length ? (
                    <CardContent>
                      <div className="flex flex-wrap gap-1.5">
                        {channel.links.map((link) => (
                          <Badge key={`${link.platform}-${link.url}`} variant="secondary" className="capitalize">
                            {link.platform}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  ) : null}
                </Card>
              </Link>
            );
          })}
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">{t.empty}</p>
      )}
    </main>
  );
}
