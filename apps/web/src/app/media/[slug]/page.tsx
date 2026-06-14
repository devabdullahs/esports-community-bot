import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, ExternalLinkIcon, Tv2Icon } from "lucide-react";
import { PageBreadcrumb } from "@/components/page-breadcrumb";
import { Button } from "@/components/ui/button";
import { localizeText } from "@/lib/community-content";
import { copy, localizedPath } from "@/lib/i18n";
import { getMediaChannelCached } from "@/lib/media";
import { getRequestLocale } from "@/lib/request-locale";
import { safeUrlOrUndefined } from "@/lib/safe-url";
import { buildPageMetadata } from "@/lib/metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const [channel, locale] = await Promise.all([getMediaChannelCached(slug), getRequestLocale()]);
  if (!channel) return {};
  return buildPageMetadata({
    title: localizeText(channel.name, locale),
    description: localizeText(channel.description, locale),
    path: localizedPath(`/media/${slug}`, locale),
    image: channel.logoUrl,
  });
}

const PLATFORM_LABELS: Record<string, string> = {
  x: "X (Twitter)",
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  twitch: "Twitch",
  website: "Website",
};

const BACK = { en: "All channels", ar: "كل القنوات" } as const;

export default async function MediaChannelPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getRequestLocale();
  const channel = await getMediaChannelCached(slug);
  if (!channel) notFound();

  const logo = safeUrlOrUndefined(channel.logoUrl);
  const common = copy[locale].common;

  return (
    <main
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-10 sm:px-8"
    >
      <PageBreadcrumb
        items={[
          { label: common.home, href: localizedPath("/", locale) },
          { label: common.media, href: localizedPath("/media", locale) },
          { label: localizeText(channel.name, locale) },
        ]}
      />
      <Button
        render={<Link href={localizedPath("/media", locale)} />}
        nativeButton={false}
        variant="ghost"
        className="w-fit"
      >
        <ArrowLeftIcon data-icon="inline-start" className="rtl:rotate-180" />
        {BACK[locale]}
      </Button>

      <header className="flex items-center gap-4">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="size-16 shrink-0 rounded-lg border border-border object-cover" />
        ) : (
          <span className="flex size-16 shrink-0 items-center justify-center rounded-lg border bg-muted">
            <Tv2Icon className="size-7" />
          </span>
        )}
        <h1 className="text-3xl font-semibold leading-tight">{localizeText(channel.name, locale)}</h1>
      </header>

      {localizeText(channel.description, locale) ? (
        <p className="article-copy text-base leading-7 text-muted-foreground">
          {localizeText(channel.description, locale)}
        </p>
      ) : null}

      {channel.links.length ? (
        <div className="flex flex-wrap gap-2">
          {channel.links.map((link) => {
            const href = safeUrlOrUndefined(link.url);
            if (!href) return null;
            return (
              <Button
                key={`${link.platform}-${link.url}`}
                render={
                  <a href={href} target="_blank" rel="noopener noreferrer nofollow" />
                }
                nativeButton={false}
                variant="outline"
                size="sm"
              >
                {PLATFORM_LABELS[link.platform] ?? link.platform}
                <ExternalLinkIcon data-icon="inline-end" />
              </Button>
            );
          })}
        </div>
      ) : null}
    </main>
  );
}
