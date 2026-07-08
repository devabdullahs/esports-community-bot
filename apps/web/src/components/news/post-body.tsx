import type { ComponentPropsWithoutRef } from "react";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkEmoji from "remark-emoji";
import remarkGfm from "remark-gfm";
import remarkSmartypants from "remark-smartypants";
import { safeUrlOrUndefined } from "@/lib/safe-url";
import { cn } from "@/lib/utils";

// GFM, emoji, smart typography, and code syntax highlighting. rehype-highlight
// only adds classes to <code>, so still no raw HTML / dangerouslySetInnerHTML.
// The admin live preview and public post pages share this renderer.
const components: Components = {
  a({ href, children, ...props }) {
    const safe = safeUrlOrUndefined(href);
    if (!safe) return <span>{children}</span>;
    return (
      <a href={safe} target="_blank" rel="noopener noreferrer nofollow" {...props}>
        {children}
      </a>
    );
  },
  img({ src, alt }) {
    const safe = safeUrlOrUndefined(typeof src === "string" ? src : undefined);
    if (!safe) return null;
    // eslint-disable-next-line @next/next/no-img-element -- external/admin URLs; next/image needs per-domain config
    return <img src={safe} alt={alt ?? ""} loading="lazy" />;
  },
};

export function PostBody({
  markdown,
  className,
  dir,
}: {
  markdown: string;
  className?: string;
  dir?: ComponentPropsWithoutRef<"div">["dir"];
}) {
  return (
    <div
      dir={dir}
      className={cn(
        "article-copy post-body text-start",
        dir === "rtl" &&
          "[&_h1]:text-right [&_h2]:text-right [&_h3]:text-right [&_h4]:text-right [&_h1]:[unicode-bidi:isolate] [&_h2]:[unicode-bidi:isolate] [&_h3]:[unicode-bidi:isolate] [&_h4]:[unicode-bidi:isolate] [&_pre]:text-left [&_pre]:[direction:ltr]",
        className,
      )}
    >
      <Markdown
        remarkPlugins={[remarkGfm, remarkSmartypants, [remarkEmoji, { emoticon: true }]]}
        rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}
        components={components}
      >
        {markdown}
      </Markdown>
    </div>
  );
}
