"use client";

import { useCallback, useState } from "react";
import type { SVGProps } from "react";
import { CheckIcon, LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type Locale } from "@/lib/i18n";
import { shareCopy } from "@/lib/share-i18n";

// Brand X (formerly Twitter) glyph. lucide's XIcon is a close (×) mark, not the
// brand, so we inline the logo here (mirrors DiscordIcon's approach).
function XLogoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" {...props}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  );
}

// Lightweight social-share row for a published post: open an X intent in a new
// tab, or copy the canonical link. No backend — the URL is the post's canonical
// absolute URL, computed server-side and passed in.
export function PostShare({
  url,
  title,
  locale,
}: {
  url: string;
  title: string;
  locale: Locale;
}) {
  const t = shareCopy[locale];
  const [copied, setCopied] = useState(false);

  const xHref = `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`;

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API unavailable (older browser / non-secure context): fall
      // back to a hidden textarea + execCommand so the button still works.
      const el = document.createElement("textarea");
      el.value = url;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand("copy");
      } catch {
        /* nothing else to try — leave the link unselected */
      }
      document.body.removeChild(el);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [url]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium text-muted-foreground">{t.share}</span>
      <Button
        render={<a href={xHref} target="_blank" rel="noopener noreferrer" />}
        nativeButton={false}
        variant="outline"
        size="sm"
      >
        <XLogoIcon data-icon="inline-start" />
        {t.shareOnX}
      </Button>
      <Button variant="outline" size="sm" onClick={copyLink}>
        {copied ? (
          <CheckIcon data-icon="inline-start" />
        ) : (
          <LinkIcon data-icon="inline-start" />
        )}
        <span aria-live="polite">{copied ? t.copied : t.copyLink}</span>
      </Button>
    </div>
  );
}
