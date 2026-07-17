import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { CommentsSection } from "@/components/comments/comments-section";
import { DateTime } from "@/components/date-time";
import { AuthorAvatar } from "@/components/news/author-avatar";
import { PostBody } from "@/components/news/post-body";
import { PostShare } from "@/components/news/post-share";
import { PageBreadcrumb } from "@/components/page-breadcrumb";
import { Button } from "@/components/ui/button";
import { localizeText } from "@/lib/community-content";
import { copy, localizedPath } from "@/lib/i18n";
import { getMediaChannelCached } from "@/lib/media";
import { getPublishedNewsPostCached } from "@/lib/news";
import { parsePostId } from "@/lib/news-validation";
import { getRequestLocale } from "@/lib/request-locale";
import { safeUrlOrUndefined } from "@/lib/safe-url";
import { absoluteUrl, buildPageMetadata, siteIconUrl, siteName } from "@/lib/metadata";
import {
  newsCanonicalLocale,
  newsLanguagePaths,
  newsPublicPath,
} from "@/lib/news-url";

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
  if (!post || post.mediaSlug !== slug) return {};
  const contentLocale = newsCanonicalLocale(post, locale);
  const translation = post.translations[contentLocale];
  return buildPageMetadata({
    title: translation?.title || post.title,
    description: translation?.summary || translation?.body?.slice(0, 200) || post.summary,
    path: newsPublicPath(post, contentLocale),
    image: post.coverImageUrl,
    locale: contentLocale,
    languagePaths: newsLanguagePaths(post),
  });
}

function jsonLd(data: unknown) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export default async function MediaNewsPostPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const locale = await getRequestLocale();

  const channel = await getMediaChannelCached(slug);
  if (!channel) notFound();

  const postId = parsePostId(id);
  if (postId === null) notFound();
  const post = await getPublishedNewsPostCached(postId, locale);
  // Reject drafts (handled by getPublishedNewsPost) and cross-channel id guessing.
  if (!post || post.mediaSlug !== slug) notFound();
  const contentLocale = newsCanonicalLocale(post, locale);
  const canonicalPath = newsPublicPath(post, contentLocale);
  if (contentLocale !== locale) redirect(canonicalPath);
  if (id !== String(post.id)) permanentRedirect(canonicalPath);

  const cover = safeUrlOrUndefined(post.coverImageUrl);
  const placement = post.coverPlacement;
  const coverImage = cover ? (
    // eslint-disable-next-line @next/next/no-img-element -- external/admin URL, validated http(s)
    <img src={cover} alt="" className="aspect-video w-full rounded-xl border border-border object-cover" />
  ) : null;

  const common = copy[locale].common;
  const channelName = localizeText(channel.name, locale);
  const canonicalUrl = absoluteUrl(canonicalPath);
  const publisherName = siteName(locale);
  const articleAuthors = post.authors.length
    ? post.authors.map((author) => ({ "@type": "Person", name: author.name }))
    : post.authorName
      ? [{ "@type": "Person", name: post.authorName }]
      : [{ "@type": "Organization", name: publisherName }];
  const articleStructuredData = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    mainEntityOfPage: { "@type": "WebPage", "@id": canonicalUrl },
    headline: post.title,
    description: post.summary || undefined,
    image: cover ? [cover] : undefined,
    datePublished: post.publishedAt || post.createdAt,
    dateModified: post.updatedAt || post.publishedAt || post.createdAt,
    inLanguage: contentLocale,
    articleSection: channelName,
    author: articleAuthors,
    publisher: {
      "@type": "Organization",
      name: publisherName,
      logo: { "@type": "ImageObject", url: siteIconUrl() },
    },
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8 sm:py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(articleStructuredData) }}
      />
      <PageBreadcrumb
        items={[
          { label: common.home, href: localizedPath("/", locale) },
          { label: common.media, href: localizedPath("/media", locale) },
          { label: channelName, href: localizedPath(`/media/${slug}`, locale) },
          { label: post.title },
        ]}
      />
      <Button
        render={<Link href={localizedPath(`/media/${slug}`, locale)} />}
        nativeButton={false}
        variant="ghost"
        className="w-fit"
      >
        <ArrowLeftIcon data-icon="inline-start" className="rtl:rotate-180" />
        {channelName}
      </Button>

      <article dir="auto" className="flex flex-col gap-5">
        <header className="flex flex-col gap-3">
          <h1 dir="auto" className="bidi-plaintext text-3xl font-semibold leading-tight sm:text-4xl">
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

      <PostShare url={canonicalUrl} title={post.title} locale={locale} />

      <CommentsSection target={{ type: "news", id: Number(post.id) }} locale={locale} />
    </main>
  );
}
