import Link from "next/link";
import { NewspaperIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { localizeText } from "@/lib/community-content";
import { listGames } from "@/lib/games";
import { directionForLocale, formatDateTime, localizedPath } from "@/lib/i18n";
import { listLatestPublishedNewsPosts } from "@/lib/news";
import { getRequestLocale } from "@/lib/request-locale";
import { safeUrlOrUndefined } from "@/lib/safe-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COPY = {
  en: {
    eyebrow: "News",
    title: "Community news",
    description: "The latest published posts from across every game in the community.",
    empty: "No posts published yet — check back soon.",
  },
  ar: {
    eyebrow: "الأخبار",
    title: "أخبار المجتمع",
    description: "أحدث المنشورات المنشورة من جميع الألعاب في المجتمع.",
    empty: "لا توجد منشورات منشورة بعد — تابعنا قريبًا.",
  },
} as const;

export default async function NewsHubPage() {
  const locale = await getRequestLocale();
  const t = COPY[locale];
  const posts = listLatestPublishedNewsPosts(locale, 20);
  const games = listGames();
  const gameTitleOf = (slug: string) => {
    const game = games.find((g) => g.slug === slug);
    return game ? localizeText(game.title, locale) : slug;
  };

  return (
    <main
      lang={locale}
      dir={directionForLocale(locale)}
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-5 py-10 sm:px-8"
    >
      <section className="flex max-w-3xl flex-col items-start gap-4">
        <Badge variant="outline">
          <NewspaperIcon data-icon="inline-start" />
          {t.eyebrow}
        </Badge>
        <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">{t.title}</h1>
        <p className="text-sm leading-6 text-muted-foreground sm:text-base">{t.description}</p>
      </section>

      {posts.length ? (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => {
            const cover = safeUrlOrUndefined(post.coverImageUrl);
            return (
              <Link
                key={post.id}
                href={localizedPath(`/games/${post.gameSlug}/news/${post.id}`, locale)}
                className="group block"
              >
                <Card
                  size="sm"
                  className="h-full overflow-hidden transition-[box-shadow] group-hover:shadow-md group-hover:ring-primary/40"
                >
                  {cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cover} alt="" className="aspect-video w-full object-cover" />
                  ) : null}
                  <CardHeader>
                    <Badge variant="secondary" className="mb-2 w-fit">
                      {gameTitleOf(post.gameSlug)}
                    </Badge>
                    <CardTitle>{post.title}</CardTitle>
                    {post.summary ? (
                      <CardDescription className="article-copy line-clamp-2">
                        {post.summary}
                      </CardDescription>
                    ) : null}
                    {post.publishedAt ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDateTime(post.publishedAt, locale)}
                      </p>
                    ) : null}
                  </CardHeader>
                </Card>
              </Link>
            );
          })}
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">{t.empty}</p>
      )}
    </main>
  );
}
