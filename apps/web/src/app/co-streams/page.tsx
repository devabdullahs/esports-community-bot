import type { Metadata } from "next";
import { headers } from "next/headers";
import { CoStreamsView } from "@/components/streams/co-streams-view";
import { sanitizeRequestedStreamIds } from "@/lib/co-stream-multiview";
import { getAllCoStreamsCached } from "@/lib/co-streams";
import { dashboardPublicUrl } from "@/lib/env";
import { localizedPath, type Locale } from "@/lib/i18n";
import { buildPageMetadata } from "@/lib/metadata";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const META: Record<Locale, { title: string; description: string }> = {
  en: {
    title: "Co-streams",
    description:
      "Watch the community's co-streamers — live Twitch, Kick, and YouTube channels for the Esports World Cup and every tracked event, all in one place.",
  },
  ar: {
    title: "البث المصاحب",
    description:
      "شاهد المذيعين المصاحبين للمجتمع — قنوات تويتش وكيك ويوتيوب المباشرة لكأس العالم للرياضات الإلكترونية وكل البطولات المتابعة في مكان واحد.",
  },
};

// Twitch requires the embedding host as the `parent` param. Use the actual
// request host so canonical, www, CranL preview, and local URLs all work.
async function parentHost(): Promise<string> {
  const fallback = (() => {
    try {
      return new URL(dashboardPublicUrl()).hostname;
    } catch {
      return "localhost";
    }
  })();
  const h = await headers();
  const raw = (h.get("x-forwarded-host")?.split(",")[0] || h.get("host")?.split(",")[0] || "")
    .trim()
    .replace(/:\d+$/, "");
  // Only trust a request host that looks like a real hostname; otherwise use the
  // configured public host. (Twitch's `parent` must be the serving host.)
  return /^[a-z0-9.-]{1,253}$/i.test(raw) ? raw : fallback;
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const meta = META[locale];
  return buildPageMetadata({
    title: meta.title,
    description: meta.description,
    path: localizedPath("/co-streams", locale),
    locale,
  });
}

export default async function CoStreamsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await getRequestLocale();
  const streams = await getAllCoStreamsCached();
  const params = await searchParams;
  const hasExplicitSelection = Object.prototype.hasOwnProperty.call(params, "stream");
  const requestedStreamIds = sanitizeRequestedStreamIds(params.stream);
  return (
    <CoStreamsView
      streams={streams}
      parent={await parentHost()}
      locale={locale}
      requestedStreamIds={requestedStreamIds}
      hasExplicitSelection={hasExplicitSelection}
    />
  );
}
