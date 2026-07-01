import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowUpRightIcon,
  CalendarDaysIcon,
  NewspaperIcon,
  SparklesIcon,
} from "lucide-react";

import { DateTime } from "@/components/date-time";
import { GameLogoMark } from "@/components/game-logo-mark";
import { PageBreadcrumb } from "@/components/page-breadcrumb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { gameTitleForSlug, listGamesCached } from "@/lib/games";
import { copy, localizedPath, type Locale } from "@/lib/i18n";
import {
  listLatestPublishedNewsPostsCached,
  type NewsPost,
} from "@/lib/news";
import { safeUrlOrUndefined } from "@/lib/safe-url";

const COPY = {
  en: {
    eyebrow: "Newsroom",
    title: "Community news",
    description:
      "Follow official updates, tournament stories, match notes, and game-specific coverage from the Esports Community staff.",
    ewcTitle: "EWC newsroom",
    ewcDescription:
      "Follow Esports World Cup updates, prediction announcements, tournament notes, and community coverage.",
    emptyTitle: "No posts published yet",
    emptyDescription: "Fresh updates will appear here once the staff publishes them.",
    featured: "Featured",
    latestStory: "Latest story",
    allUpdates: "All updates",
    posts: "Published posts",
    gamesCovered: "Games covered",
    ewcPosts: "EWC posts",
    latestUpdate: "Latest update",
    topCoverage: "Top coverage",
    readStory: "Read story",
    allNews: "All news",
    ewcNews: "EWC news",
    page: "Page",
    media: "Media",
    general: "General",
  },
  ar: {
    eyebrow: "\u063a\u0631\u0641\u0629 \u0627\u0644\u0623\u062e\u0628\u0627\u0631",
    title: "\u0623\u062e\u0628\u0627\u0631 \u0627\u0644\u0645\u062c\u062a\u0645\u0639",
    description:
      "\u062a\u0627\u0628\u0639 \u0627\u0644\u062a\u062d\u062f\u064a\u062b\u0627\u062a \u0627\u0644\u0631\u0633\u0645\u064a\u0629\u060c \u0642\u0635\u0635 \u0627\u0644\u0628\u0637\u0648\u0644\u0627\u062a\u060c \u0645\u0644\u0627\u062d\u0638\u0627\u062a \u0627\u0644\u0645\u0628\u0627\u0631\u064a\u0627\u062a\u060c \u0648\u062a\u063a\u0637\u064a\u0629 \u0627\u0644\u0623\u0644\u0639\u0627\u0628 \u0645\u0646 \u0641\u0631\u064a\u0642 \u0645\u062c\u062a\u0645\u0639 \u0627\u0644\u0631\u064a\u0627\u0636\u0627\u062a \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a\u0629.",
    ewcTitle: "\u063a\u0631\u0641\u0629 \u0623\u062e\u0628\u0627\u0631 EWC",
    ewcDescription:
      "\u062a\u0627\u0628\u0639 \u0623\u062e\u0628\u0627\u0631 \u0643\u0623\u0633 \u0627\u0644\u0639\u0627\u0644\u0645 \u0644\u0644\u0631\u064a\u0627\u0636\u0627\u062a \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a\u0629\u060c \u0625\u0639\u0644\u0627\u0646\u0627\u062a \u0627\u0644\u062a\u0648\u0642\u0639\u0627\u062a\u060c \u0645\u0644\u0627\u062d\u0638\u0627\u062a \u0627\u0644\u0628\u0637\u0648\u0644\u0627\u062a\u060c \u0648\u062a\u063a\u0637\u064a\u0629 \u0627\u0644\u0645\u062c\u062a\u0645\u0639.",
    emptyTitle: "\u0644\u0627 \u062a\u0648\u062c\u062f \u0645\u0646\u0634\u0648\u0631\u0627\u062a \u062d\u062a\u0649 \u0627\u0644\u0622\u0646",
    emptyDescription:
      "\u0633\u062a\u0638\u0647\u0631 \u0627\u0644\u062a\u062d\u062f\u064a\u062b\u0627\u062a \u0647\u0646\u0627 \u0628\u0645\u062c\u0631\u062f \u0646\u0634\u0631\u0647\u0627 \u0645\u0646 \u0641\u0631\u064a\u0642 \u0627\u0644\u0625\u062f\u0627\u0631\u0629.",
    featured: "\u0645\u0645\u064a\u0632",
    latestStory: "\u0623\u062d\u062f\u062b \u062e\u0628\u0631",
    allUpdates: "\u0643\u0644 \u0627\u0644\u062a\u062d\u062f\u064a\u062b\u0627\u062a",
    posts: "\u0627\u0644\u0645\u0646\u0634\u0648\u0631\u0627\u062a",
    gamesCovered: "\u0627\u0644\u0623\u0644\u0639\u0627\u0628 \u0627\u0644\u0645\u063a\u0637\u0627\u0629",
    ewcPosts: "\u0623\u062e\u0628\u0627\u0631 EWC",
    latestUpdate: "\u0622\u062e\u0631 \u062a\u062d\u062f\u064a\u062b",
    topCoverage: "\u0623\u0628\u0631\u0632 \u0627\u0644\u062a\u063a\u0637\u064a\u0629",
    readStory: "\u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u062e\u0628\u0631",
    allNews: "\u0643\u0644 \u0627\u0644\u0623\u062e\u0628\u0627\u0631",
    ewcNews: "\u0623\u062e\u0628\u0627\u0631 EWC",
    page: "\u0635\u0641\u062d\u0629",
    media: "\u0627\u0644\u0625\u0639\u0644\u0627\u0645",
    general: "\u0639\u0627\u0645",
  },
} as const;

const PAGE_SIZE = 20;
const EWC_PAGE_SIZE = 50;

type CoverageItem = {
  key: string;
  slug: string | null;
  label: string;
  count: number;
  ewc: boolean;
};

function postHref(post: NewsPost, locale: Locale) {
  if (post.gameSlug) {
    return localizedPath(`/games/${post.gameSlug}/news/${post.id}`, locale);
  }
  if (post.mediaSlug) {
    return localizedPath(`/media/${post.mediaSlug}/news/${post.id}`, locale);
  }
  return localizedPath("/news", locale);
}

function postCover(post: NewsPost) {
  return safeUrlOrUndefined(post.coverImageUrl);
}

function NewsMetricCard({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <Card size="sm" className="bg-background/40 shadow-none">
      <CardContent className="p-3 sm:p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="mt-2 text-xl font-semibold leading-none text-foreground sm:text-2xl">
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

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
  const pageSize = ewcOnly ? EWC_PAGE_SIZE : PAGE_SIZE;
  const current = Math.max(1, page);
  const offset = (current - 1) * pageSize;
  const fetched = await listLatestPublishedNewsPostsCached(
    locale,
    pageSize + 1,
    ewcOnly,
    offset,
  );
  const hasNext = fetched.length > pageSize;
  const posts = fetched.slice(0, pageSize);
  const featured = posts[0] ?? null;
  const remainingPosts = posts.slice(1);
  const basePath = ewcOnly ? "/news/ewc" : "/news";
  const games = await listGamesCached();
  const gameTitleOf = (slug: string) => gameTitleForSlug(slug, games, locale);
  const labelForPost = (post: NewsPost) => {
    if (post.gameSlug) return gameTitleOf(post.gameSlug);
    if (post.mediaSlug) return t.media;
    return t.general;
  };
  const numberFormatter = new Intl.NumberFormat(locale === "ar" ? "ar-SA" : "en-US");
  const gameCount = new Set(posts.map((post) => post.gameSlug).filter(Boolean)).size;
  const ewcCount = posts.filter((post) => post.ewc).length;
  const latestPost = posts.find((post) => post.publishedAt);
  const coverageItems = Array.from(
    posts
      .reduce((map, post) => {
        const key = post.gameSlug
          ? `game:${post.gameSlug}`
          : post.mediaSlug
            ? `media:${post.mediaSlug}`
            : "general";
        const existing = map.get(key);
        if (existing) {
          existing.count += 1;
          existing.ewc ||= post.ewc;
          return map;
        }
        map.set(key, {
          key,
          slug: post.gameSlug ?? post.mediaSlug ?? "news",
          label: labelForPost(post),
          count: 1,
          ewc: post.ewc,
        });
        return map;
      }, new Map<string, CoverageItem>())
      .values(),
  )
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 6);
  const heading = ewcOnly ? t.ewcTitle : t.title;
  const description = ewcOnly ? t.ewcDescription : t.description;
  const featuredCover = featured ? postCover(featured) : null;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 overflow-hidden px-4 py-8 sm:gap-8 sm:px-8 sm:py-10">
      <PageBreadcrumb
        items={[
          { label: common.home, href: localizedPath("/", locale) },
          { label: ewcOnly ? common.ewcNews : common.news },
        ]}
      />

      <section className="relative overflow-hidden rounded-2xl border bg-card/35 p-4 shadow-sm shadow-black/10 sm:rounded-3xl sm:p-8">
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent"
        />
        <div className="relative grid min-w-0 gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-center xl:gap-8">
          <div className="flex min-w-0 max-w-3xl flex-col items-start gap-4 sm:gap-5">
            <Badge variant="outline" className="border-primary/35 bg-primary/10 text-primary">
              <NewspaperIcon data-icon="inline-start" />
              {ewcOnly ? common.ewcNews : t.eyebrow}
            </Badge>
            <div className="flex flex-col gap-3">
              <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-5xl">
                {heading}
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                {description}
              </p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
              <Button
                render={<Link href={localizedPath("/news", locale)} />}
                nativeButton={false}
                variant={ewcOnly ? "outline" : "default"}
                className="w-full sm:w-auto"
              >
                {t.allNews}
              </Button>
              <Button
                render={<Link href={localizedPath("/news/ewc", locale)} />}
                nativeButton={false}
                variant={ewcOnly ? "default" : "outline"}
                className="w-full sm:w-auto"
              >
                {t.ewcNews}
              </Button>
            </div>
          </div>

          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <NewsMetricCard label={t.posts} value={numberFormatter.format(posts.length)} />
            <NewsMetricCard label={t.gamesCovered} value={numberFormatter.format(gameCount)} />
            <NewsMetricCard label={t.ewcPosts} value={numberFormatter.format(ewcCount)} />
            <NewsMetricCard
              label={t.latestUpdate}
              value={
                <span className="text-sm font-medium leading-none">
                  {latestPost?.publishedAt ? (
                    <DateTime value={latestPost.publishedAt} locale={locale} />
                  ) : (
                    "\u2014"
                  )}
                </span>
              }
            />
            {coverageItems.length ? (
              <Card size="sm" className="bg-background/40 shadow-none sm:col-span-2">
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">{t.topCoverage}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {coverageItems.map((item) => (
                      <Badge
                        key={item.key}
                        variant="secondary"
                        className="gap-2 rounded-full px-2.5 py-1"
                      >
                        <GameLogoMark
                          slug={item.slug}
                          label={item.label}
                          className="size-5 rounded-none border-0 bg-transparent shadow-none"
                          iconClassName="size-4"
                        />
                        {item.label}
                        <span className="rounded-full bg-background/60 px-1.5 text-[0.65rem] text-muted-foreground">
                          {numberFormatter.format(item.count)}
                        </span>
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      </section>

      {featured ? (
        <section className="grid min-w-0 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <Link href={postHref(featured, locale)} className="group block min-w-0">
            <Card className="h-full min-h-0 min-w-0 overflow-hidden rounded-2xl bg-card/70 transition-all group-hover:-translate-y-0.5 group-hover:ring-primary/40 sm:min-h-80 sm:rounded-3xl">
              {featuredCover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={featuredCover}
                  alt=""
                  className="aspect-[16/10] w-full object-cover sm:aspect-[16/7]"
                />
              ) : (
                <div className="flex aspect-[16/10] items-center justify-center bg-muted/35 sm:aspect-[16/7]">
                  <NewspaperIcon className="size-12 text-primary/70" aria-hidden="true" />
                </div>
              )}
              <CardHeader className="gap-3 p-4 sm:gap-4 sm:p-6">
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  <Badge className="border-primary/35 bg-primary/10 text-primary">
                    <SparklesIcon data-icon="inline-start" />
                    {t.featured}
                  </Badge>
                  <Badge variant="secondary">{labelForPost(featured)}</Badge>
                  {!ewcOnly && featured.ewc ? (
                    <Badge variant="outline" className="border-primary/35 text-primary">
                      {common.ewc}
                    </Badge>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2">
                  <CardTitle dir="auto" className="line-clamp-2 text-xl sm:text-3xl">
                    {featured.title}
                  </CardTitle>
                  {featured.summary ? (
                    <CardDescription
                      dir="auto"
                      className="article-copy line-clamp-2 text-sm leading-6 sm:line-clamp-3 sm:text-base sm:leading-7"
                    >
                      {featured.summary}
                    </CardDescription>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground sm:text-sm">
                  {featured.publishedAt ? (
                    <span className="inline-flex items-center gap-2">
                      <CalendarDaysIcon className="size-4" aria-hidden="true" />
                      <DateTime value={featured.publishedAt} locale={locale} />
                    </span>
                  ) : null}
                  <span className="inline-flex items-center gap-1 font-medium text-primary">
                    {t.readStory}
                    <ArrowUpRightIcon className="size-4" aria-hidden="true" />
                  </span>
                </div>
              </CardHeader>
            </Card>
          </Link>

          <div className="min-w-0 rounded-2xl border bg-card/25 p-3 shadow-sm shadow-black/10 sm:rounded-3xl sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">{t.latestStory}</p>
                <h2 className="font-semibold">{t.allUpdates}</h2>
              </div>
              <Badge variant="outline">
                {t.page} {numberFormatter.format(current)}
              </Badge>
            </div>
            <Separator />
            <div className="flex flex-col gap-2 py-3">
              {posts.slice(0, 5).map((post) => (
                <Link
                  key={post.id}
                  href={postHref(post, locale)}
                  className="group flex min-w-0 items-center gap-3 rounded-2xl border border-transparent p-2 transition hover:border-primary/30 hover:bg-muted/35"
                >
                  <GameLogoMark
                    slug={post.gameSlug}
                    label={labelForPost(post)}
                    className="size-9 rounded-xl sm:size-10"
                    iconClassName="size-[1.125rem] sm:size-5"
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      dir="auto"
                      className="line-clamp-2 text-sm font-medium leading-5 group-hover:text-primary"
                    >
                      {post.title}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {labelForPost(post)}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border bg-card/25 p-5 text-center sm:rounded-3xl sm:p-8">
          <NewspaperIcon className="mx-auto size-10 text-primary/70" aria-hidden="true" />
          <h2 className="mt-4 text-xl font-semibold">{t.emptyTitle}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            {t.emptyDescription}
          </p>
        </section>
      )}

      {remainingPosts.length ? (
        <section className="flex flex-col gap-4 rounded-2xl border bg-card/25 p-4 shadow-sm shadow-black/10 sm:rounded-3xl sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs text-muted-foreground">{t.allUpdates}</p>
              <h2 className="text-xl font-semibold sm:text-2xl">
                {ewcOnly ? common.ewcNews : common.news}
              </h2>
            </div>
            <Badge variant="outline" className="w-fit">
              {numberFormatter.format(remainingPosts.length)} {t.posts}
            </Badge>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {remainingPosts.map((post) => {
              const cover = postCover(post);
              return (
                <Link key={post.id} href={postHref(post, locale)} className="group block">
                  <Card
                    size="sm"
                    className="h-full ring-1 ring-transparent transition-all group-hover:-translate-y-0.5 group-hover:border-primary/30 group-hover:shadow-md group-hover:shadow-black/15 group-hover:ring-primary/40"
                  >
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover} alt="" className="aspect-video w-full object-cover" />
                    ) : null}
                    <CardHeader>
                      <div className="mb-2 flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary" className="w-fit">
                          <GameLogoMark
                            slug={post.gameSlug}
                            label={labelForPost(post)}
                            className="size-4 rounded-none border-0 bg-transparent shadow-none"
                            iconClassName="size-3"
                          />
                          {labelForPost(post)}
                        </Badge>
                        {!ewcOnly && post.ewc ? (
                          <Badge className="w-fit border-primary/35 bg-primary/10 text-primary">
                            {common.ewc}
                          </Badge>
                        ) : null}
                      </div>
                      <CardTitle dir="auto" className="line-clamp-2">
                        {post.title}
                      </CardTitle>
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
                    <CardContent className="mt-auto pt-0">
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                        {t.readStory}
                        <ArrowUpRightIcon className="size-3.5" aria-hidden="true" />
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {current > 1 || hasNext ? (
        <nav className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {current > 1 ? (
            <Button
              render={<Link href={localizedPath(`${basePath}?page=${current - 1}`, locale)} />}
              nativeButton={false}
              variant="outline"
              className="w-full sm:w-auto"
            >
              {common.newer}
            </Button>
          ) : (
            <span />
          )}
          {hasNext ? (
            <Button
              render={<Link href={localizedPath(`${basePath}?page=${current + 1}`, locale)} />}
              nativeButton={false}
              variant="outline"
              className="w-full sm:w-auto"
            >
              {common.older}
            </Button>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </main>
  );
}
