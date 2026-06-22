import Link from "next/link";
import { NewspaperIcon } from "lucide-react";
import { DateTime } from "@/components/date-time";
import { PageBreadcrumb } from "@/components/page-breadcrumb";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { localizeText } from "@/lib/community-content";
import { listGamesCached } from "@/lib/games";
import { copy, localizedPath, type Locale } from "@/lib/i18n";
import { listLatestPublishedNewsPostsCached } from "@/lib/news";
import { safeUrlOrUndefined } from "@/lib/safe-url";

const COPY = {
  en: {
    eyebrow: "News",
    title: "Community news",
    description: "The latest published posts from across every game in the community.",
    ewcTitle: "EWC news",
    ewcDescription: "The latest posts tagged for the Esports World Cup.",
    empty: "No posts published yet — check back soon.",
  },
  ar: {
    eyebrow: "الأخبار",
    title: "أخبار المجتمع",
    description: "أحدث المنشورات المنشورة من جميع الألعاب في المجتمع.",
    ewcTitle: "أخبار EWC",
    ewcDescription: "أحدث المنشورات الموسومة بكأس العالم للرياضات الإلكترونية.",
    empty: "لا توجد منشورات منشورة بعد — تابعنا قريبًا.",
  },
} as const;

// Shared news grid. `ewcOnly` narrows to posts an admin tagged as EWC-related;
// otherwise every published post (general + EWC-tagged) is shown.
export async function NewsHubView({
  locale,
  ewcOnly = false,
  page = 1,
}: {
  locale: Locale;
  ewcOnly?: boolean;
  page?: number;
}) {
  const t = COPY[locale];
  const common = copy[locale].common;
  const PAGE_SIZE = ewcOnly ? 50 : 20;
  const current = Math.max(1, page);
  const offset = (current - 1) * PAGE_SIZE;
  // Fetch one extra row to detect whether an "Older" page exists without a count query.
  const fetched = await listLatestPublishedNewsPostsCached(locale, PAGE_SIZE + 1, ewcOnly, offset);
  const hasNext = fetched.length > PAGE_SIZE;
  const posts = fetched.slice(0, PAGE_SIZE);
  const basePath = ewcOnly ? "/news/ewc" : "/news";
  const games = await listGamesCached();
  const gameTitleOf = (slug: string) => {
    const game = games.find((g) => g.slug === slug);
    return game ? localizeText(game.title, locale) : slug;
  };

  const heading = ewcOnly ? t.ewcTitle : t.title;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-5 py-10 sm:px-8">
      <PageBreadcrumb
        items={[
          { label: common.home, href: localizedPath("/", locale) },
          { label: ewcOnly ? common.ewcNews : common.news },
        ]}
      />
      <section className="flex max-w-3xl flex-col items-start gap-4">
        <Badge variant="outline">
          <NewspaperIcon data-icon="inline-start" />
          {ewcOnly ? common.ewcNews : t.eyebrow}
        </Badge>
        <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">{heading}</h1>
        <p className="text-sm leading-6 text-muted-foreground sm:text-base">
          {ewcOnly ? t.ewcDescription : t.description}
        </p>
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
                  className="h-full overflow-hidden ring-1 ring-transparent transition-all group-hover:-translate-y-0.5 group-hover:border-primary/30 group-hover:shadow-md group-hover:ring-primary/40"
                >
                  {cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cover} alt="" className="aspect-video w-full object-cover" />
                  ) : null}
                  <CardHeader>
                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary" className="w-fit">
                        {gameTitleOf(post.gameSlug ?? "")}
                      </Badge>
                      {!ewcOnly && post.ewc ? (
                        <Badge className="w-fit border-primary/35 bg-primary/10 text-primary">
                          {common.ewc}
                        </Badge>
                      ) : null}
                    </div>
                    <CardTitle dir="auto">{post.title}</CardTitle>
                    {post.summary ? (
                      <CardDescription dir="auto" className="article-copy line-clamp-2">
                        {post.summary}
                      </CardDescription>
                    ) : null}
                    {post.publishedAt ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        <DateTime value={post.publishedAt} locale={locale} />
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

      {current > 1 || hasNext ? (
        <nav className="flex items-center justify-between gap-3">
          {current > 1 ? (
            <Link
              href={localizedPath(`${basePath}?page=${current - 1}`, locale)}
              className="text-sm font-medium text-primary hover:underline"
            >
              {common.newer}
            </Link>
          ) : (
            <span />
          )}
          {hasNext ? (
            <Link
              href={localizedPath(`${basePath}?page=${current + 1}`, locale)}
              className="text-sm font-medium text-primary hover:underline"
            >
              {common.older}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </main>
  );
}
