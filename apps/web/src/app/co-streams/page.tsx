import type { Metadata } from "next";
import { headers } from "next/headers";
import { CoStreamsView } from "@/components/streams/co-streams-view";
import { getEwcCoStreamsCached } from "@/lib/co-streams";
import { dashboardPublicUrl } from "@/lib/env";
import { localizedPath, type Locale } from "@/lib/i18n";
import { buildPageMetadata } from "@/lib/metadata";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const META: Record<Locale, { title: string; description: string }> = {
  en: {
    title: "EWC co-streams",
    description: "Watch the official Esports World Cup co-streamers — live Twitch and Kick channels, all in one place.",
  },
  ar: {
    title: "البث المصاحب لكأس العالم للرياضات الإلكترونية",
    description:
      "شاهد المذيعين المصاحبين الرسميين لكأس العالم للرياضات الإلكترونية — قنوات تويتش وكيك المباشرة في مكان واحد.",
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

export default async function CoStreamsPage() {
  const locale = await getRequestLocale();
  const streams = await getEwcCoStreamsCached();
  return <CoStreamsView streams={streams} parent={await parentHost()} locale={locale} />;
}
