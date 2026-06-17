import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { CommentsSection } from "@/components/comments/comments-section";
import { DateTime } from "@/components/date-time";
import { AuthorAvatar } from "@/components/news/author-avatar";
import { PostBody } from "@/components/news/post-body";
import { PageBreadcrumb } from "@/components/page-breadcrumb";
import { Button } from "@/components/ui/button";
import { localizeText } from "@/lib/community-content";
import { getGameCached } from "@/lib/games";
import {
  copy,
  localizedPath,
} from "@/lib/i18n";
import { getPublishedNewsPostCached } from "@/lib/news";
import { parsePostId } from "@/lib/news-validation";
import { getRequestLocale } from "@/lib/request-locale";
import { safeUrlOrUndefined } from "@/lib/safe-url";
import { absoluteUrl, buildPageMetadata, siteIconUrl, siteName } from "@/lib/metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}): Promise<Metadata> {
  const { slug, id } = await params;
  const postId = parsePostId(id);
  if (postId === null) return {};
  const locale = await getRequestLocale();
  const post = await getPublishedNewsPostCached(postId, locale);
  if (!post || post.gameSlug !== slug) return {};
  return buildPageMetadata({
    title: post.title,
    description: post.summary || post.body.slice(0, 200),
    path: localizedPath(`/games/${slug}/news/${id}`, locale),
    image: post.coverImageUrl,
    locale,
  });
}

function jsonLd(data: unknown) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export default async function NewsPostPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const locale = await getRequestLocale();

  const game = await getGameCached(slug);
  if (!game) notFound();

  const postId = parsePostId(id);
  if (postId === null) notFound();
  const post = await getPublishedNewsPostCached(postId, locale);
  // Reject drafts (handled by getPublishedNewsPost) and cross-game id guessing.
  if (!post || post.gameSlug !== slug) notFound();

  const cover = safeUrlOrUndefined(post.coverImageUrl);
  const placement = post.coverPlacement;
  const coverImage = cover ? (
    // eslint-disable-next-line @next/next/no-img-element -- external/admin URL, validated http(s)
    <img
      src={cover}
      alt=""
      className="w-full rounded-xl border border-border object-cover"
    />
  ) : null;

  const common = copy[locale].common;
  const gameTitle = localizeText(game.title, locale);
  const canonicalUrl = absoluteUrl(localizedPath(`/games/${slug}/news/${id}`, locale));
  const publisherName = siteName(locale);
  const articleAuthors = post.authors.length
    ? post.authors.map((author) => ({ "@type": "Person", name: author.name }))
    : post.authorName
      ? [{ "@type": "Person", name: post.authorName }]
      : [{ "@type": "Organization", name: publisherName }];
  const articleStructuredData = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": canonicalUrl,
    },
    headline: post.title,
    description: post.summary || undefined,
    image: cover ? [cover] : undefined,
    datePublished: post.publishedAt || post.createdAt,
    dateModified: post.updatedAt || post.publishedAt || post.createdAt,
    inLanguage: locale,
    articleSection: gameTitle,
    author: articleAuthors,
    publisher: {
      "@type": "Organization",
      name: publisherName,
      logo: {
        "@type": "ImageObject",
        url: siteIconUrl(),
      },
    },
  };

  return (
    <main
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-10 sm:px-8"
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(articleStructuredData) }}
      />
      <PageBreadcrumb
        items={[
          { label: common.home, href: localizedPath("/", locale) },
          { label: common.games, href: localizedPath("/games", locale) },
          {
            label: localizeText(game.title, locale),
            href: localizedPath(`/games/${slug}`, locale),
          },
          { label: post.title },
        ]}
      />
      <Button
        render={<Link href={localizedPath(`/games/${slug}`, locale)} />}
        nativeButton={false}
        variant="ghost"
        className="w-fit"
      >
        <ArrowLeftIcon data-icon="inline-start" className="rtl:rotate-180" />
        {localizeText(game.title, locale)}
      </Button>

      <article dir="auto" className="flex flex-col gap-5">
        <header className="flex flex-col gap-3">
          <h1
            dir="auto"
            className="bidi-plaintext text-3xl font-semibold leading-tight sm:text-4xl"
          >
            {post.title}
          </h1>
          {post.authors.length || post.authorName || post.publishedAt ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {post.authors.length ? (
                <span className="flex items-center gap-2">
                  <span className="flex -space-x-2">
                    {post.authors.map((a) => (
                      <AuthorAvatar
                        key={a.discordId}
                        name={a.name}
                        avatarUrl={a.avatarUrl}
                        className="size-7 ring-2 ring-background"
                      />
                    ))}
                  </span>
                  <span>
                    {locale === "ar" ? "بقلم " : "By "}
                    {post.authors.map((a) => a.name).join(locale === "ar" ? "، " : ", ")}
                  </span>
                </span>
              ) : post.authorName ? (
                <span>{`${locale === "ar" ? "بقلم" : "By"} ${post.authorName}`}</span>
              ) : null}
              {(post.authors.length || post.authorName) && post.publishedAt ? (
                <span aria-hidden>·</span>
              ) : null}
              {post.publishedAt ? <DateTime value={post.publishedAt} locale={locale} /> : null}
            </div>
          ) : null}
          {post.summary ? (
            <p dir="auto" className="bidi-plaintext article-copy text-base text-muted-foreground">
              {post.summary}
            </p>
          ) : null}
        </header>

        {placement === "top" ? coverImage : null}

        <PostBody markdown={post.body} />

        {placement === "bottom" ? coverImage : null}
      </article>

      <CommentsSection postId={Number(post.id)} locale={locale} />
    </main>
  );
}
