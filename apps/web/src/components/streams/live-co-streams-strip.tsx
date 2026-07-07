import Link from "next/link";
import { RadioIcon, EyeIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getAllCoStreamsCached, type CoStream } from "@/lib/co-streams";
import { copy, localizedPath, type Locale } from "@/lib/i18n";

// Site-wide "live right now" surface: a compact strip shown on the homepage
// whenever at least one co-streamer is live, linking through to /co-streams.
// Server component; live status is the 30s-cached view the page itself uses,
// so this adds no extra DB pressure. Renders NOTHING when nobody is live.
export async function LiveCoStreamsStrip({ locale }: { locale: Locale }) {
  const text = copy[locale];
  let streams: CoStream[] = [];
  try {
    streams = (await getAllCoStreamsCached()).filter((s) => s.isLive);
  } catch {
    return null; // a status hiccup must never break the homepage
  }
  if (!streams.length) return null;

  const shown = streams.slice(0, 3);
  const href = localizedPath("/co-streams", locale);

  return (
    <section className="border-b bg-red-500/[0.04] px-4 py-4 sm:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 sm:flex-row sm:items-center">
        <Link href={href} className="flex shrink-0 items-center gap-2 font-semibold text-foreground">
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-60" />
            <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
          </span>
          {text.common.liveCoStreams}
          <Badge variant="secondary" className="tabular-nums">{streams.length}</Badge>
        </Link>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {shown.map((stream) => (
            <Link
              key={stream.id}
              href={href}
              className="flex min-w-0 items-center gap-2 rounded-full border bg-card/60 px-3 py-1.5 text-sm transition-colors hover:border-red-500/40 hover:bg-card"
            >
              <RadioIcon className="size-3.5 shrink-0 text-red-500" />
              <span className="truncate font-medium">{stream.label}</span>
              {stream.liveGame ? (
                <span className="hidden truncate text-muted-foreground sm:inline">· {stream.liveGame}</span>
              ) : null}
              {stream.viewerCount != null ? (
                <span className="hidden items-center gap-1 text-xs text-muted-foreground md:flex">
                  <EyeIcon className="size-3" />
                  {stream.viewerCount.toLocaleString(locale === "ar" ? "ar" : "en")}
                </span>
              ) : null}
            </Link>
          ))}
          {streams.length > shown.length ? (
            <Link href={href} className="text-sm text-muted-foreground hover:text-foreground">
              +{streams.length - shown.length}
            </Link>
          ) : null}
        </div>
        <Link href={href} className="shrink-0 text-sm font-medium text-red-500 hover:text-red-400">
          {text.common.watchCoStreams} →
        </Link>
      </div>
    </section>
  );
}
