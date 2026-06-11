import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { PostBody } from "@/components/news/post-body";
import { Button } from "@/components/ui/button";
import { localizeText } from "@/lib/community-content";
import { getGameCached } from "@/lib/games";
import {
  formatDateTime,
  localizedPath,
} from "@/lib/i18n";
import { getPublishedNewsPostCached } from "@/lib/news";
import { parsePostId } from "@/lib/news-validation";
import { getRequestLocale } from "@/lib/request-locale";
import { safeUrlOrUndefined } from "@/lib/safe-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  return (
    <main
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-10 sm:px-8"
    >
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
          <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">{post.title}</h1>
          {post.authorName || post.publishedAt ? (
            <p className="text-sm text-muted-foreground">
              {post.authorName ? `${locale === "ar" ? "بقلم" : "By"} ${post.authorName}` : ""}
              {post.authorName && post.publishedAt ? " · " : ""}
              {post.publishedAt ? formatDateTime(post.publishedAt, locale) : ""}
            </p>
          ) : null}
          {post.summary ? (
            <p className="article-copy text-base text-muted-foreground">{post.summary}</p>
          ) : null}
        </header>

        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- external/admin URL, validated http(s)
          <img
            src={cover}
            alt=""
            className="w-full rounded-xl border border-border object-cover"
          />
        ) : null}

        <PostBody markdown={post.body} />
      </article>
    </main>
  );
}
