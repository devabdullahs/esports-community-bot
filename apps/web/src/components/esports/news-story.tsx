import Link from "next/link";
import { DateTime } from "@/components/date-time";
import { GameLogoMark } from "@/components/game-logo-mark";
import { newsPublicPath } from "@/lib/news-url";
import type { NewsPost } from "@/lib/news";
import type { Locale } from "@/lib/i18n";
import { safeUrlOrUndefined } from "@/lib/safe-url";
import { cn } from "@/lib/utils";

export function NewsStory({
  post,
  locale,
  label,
  featured = false,
  headingLevel = 3,
}: {
  post: NewsPost;
  locale: Locale;
  label: string;
  featured?: boolean;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const cover = safeUrlOrUndefined(post.coverImageUrl);
  return (
    <article className={cn("ec-news-story", featured && "ec-news-featured")}>
      <Link href={newsPublicPath(post, locale)} className="ec-story-link">
        {cover ? (
          <div className="ec-story-image">
            {/* eslint-disable-next-line @next/next/no-img-element -- CMS-hosted editorial images have fixed aspect ratios and retain the existing image contract. */}
            <img src={cover} alt="" loading="lazy" width={800} height={450} />
          </div>
        ) : null}
        <div className="ec-story-copy">
          <p className="ec-story-category">
            <GameLogoMark
              slug={post.gameSlug ?? post.mediaSlug}
              className="size-5"
              iconClassName="size-4"
            />
            {label}
          </p>
          <Heading className="ec-story-title" dir="auto">{post.title}</Heading>
          {featured && post.summary ? (
            <p className="ec-story-summary" dir="auto">
              {post.summary}
            </p>
          ) : null}
          <span className="ec-story-meta">
            <DateTime
              value={post.publishedAt ?? post.createdAt}
              locale={locale}
            />
          </span>
        </div>
      </Link>
    </article>
  );
}
