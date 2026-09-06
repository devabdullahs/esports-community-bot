import Link from "next/link";
import { notFound } from "next/navigation";
import { GameLogoMark } from "@/components/game-logo-mark";
import { PageBreadcrumb } from "@/components/page-breadcrumb";
import { NewsStory } from "@/components/esports/news-story";
import { SectionHeading } from "@/components/esports/section-heading";
import { Button } from "@/components/ui/button";
import { localizeText } from "@/lib/community-content";
import { gameTitleForSlug, listGamesCached } from "@/lib/games";
import { copy, localizedPath, type Locale } from "@/lib/i18n";
import { listNewsroomPosts } from "@/lib/news";

export async function NewsHubView({
  locale,
  ewcOnly = false,
  page = 1,
}: {
  locale: Locale;
  ewcOnly?: boolean;
  page?: number;
}) {
  const text = copy[locale];
  const ar = locale === "ar";
  const pageSize = ewcOnly ? 50 : 20;
  const current = Math.max(1, page);
  const [fetched, games] = await Promise.all([
    listNewsroomPosts(
      locale,
      pageSize + 1,
      ewcOnly,
      (current - 1) * pageSize,
    ),
    listGamesCached(),
  ]);
  const hasNext = fetched.length > pageSize;
  const posts = fetched.slice(0, pageSize);
  if (current > 1 && !posts.length) notFound();
  const basePath = ewcOnly ? "/news/ewc" : "/news";
  return (
    <main className="ec-container ec-public-page flex flex-col gap-6 py-7">
      <PageBreadcrumb
        items={[
          { label: text.common.home, href: localizedPath("/", locale) },
          { label: ewcOnly ? text.common.ewcNews : text.common.news },
        ]}
      />
      <header className="ec-page-heading">
        <p className="ec-kicker">
          {ar ? "من قلب المشهد" : "FROM ACROSS THE SCENE"}
        </p>
        <h1>
          {ewcOnly ? text.common.ewcNews : ar ? "غرفة الأخبار" : "The newsroom"}
        </h1>
        <p>
          {ar
            ? "قصص الفرق والبطولات، وأبرز ما يجري في مجتمع الرياضات الإلكترونية."
            : "The teams, the tournaments, and the stories shaping our esports community."}
        </p>
      </header>
      <nav
        className="ec-news-filters"
        aria-label={ar ? "تغطية الأخبار" : "News coverage"}
      >
        <Link
          href={localizedPath("/news", locale)}
          aria-current={!ewcOnly ? "page" : undefined}
        >
          {ar ? "كل الأخبار" : "All news"}
        </Link>
        <Link
          href={localizedPath("/news/ewc", locale)}
          aria-current={ewcOnly ? "page" : undefined}
        >
          {text.common.ewcNews}
        </Link>
        <Link href={localizedPath("/media", locale)}>{text.common.media}</Link>
      </nav>
      <div className="ec-news-layout">
        <section aria-label={text.common.news}>
          {posts.length ? (
            posts.map((post, index) => (
              <NewsStory headingLevel={2}
                key={post.id}
                post={post}
                locale={locale}
                label={
                  post.gameSlug
                    ? gameTitleForSlug(post.gameSlug, games, locale)
                    : post.mediaSlug
                      ? text.common.media
                      : text.common.news
                }
                featured={index === 0}
              />
            ))
          ) : (
            <div className="ec-empty">
              <p>{ar ? "لم تُنشر أخبار بعد." : "No stories published yet."}</p>
              <p>
                {ar
                  ? "تابع البطولات حتى تصل التغطية القادمة."
                  : "Explore the tournaments while the next story is on its way."}
              </p>
              <Link
                href={localizedPath("/tournaments", locale)}
                className="ec-text-link"
              >
                {text.common.tournaments}
              </Link>
            </div>
          )}
        </section>
        <aside>
          <SectionHeading title={ar ? "حسب اللعبة" : "By game"} />
          {games.map((game) => (
            <Link
              className="ec-event-row"
              key={game.slug}
              href={localizedPath(`/games/${game.slug}#game-news`, locale)}
            >
              <GameLogoMark
                slug={game.slug}
                className="size-7"
                iconClassName="size-5"
              />
              <span className="text-sm">
                {localizeText(game.title, locale)}
              </span>
            </Link>
          ))}
          <Link
            className="ec-text-link mt-5"
            href={localizedPath("/tournaments", locale)}
          >
            {ar ? "تابع المنافسات" : "Follow the competition"}
          </Link>
        </aside>
      </div>
      {current > 1 || hasNext ? (
        <nav
          aria-label={ar ? "صفحات الأخبار" : "News pagination"}
          className="flex items-center justify-between gap-4 border-t pt-5"
        >
          {current > 1 ? (
            <Button
              render={
                <Link
                  href={localizedPath(
                    `${basePath}?page=${current - 1}`,
                    locale,
                  )}
                />
              }
              nativeButton={false}
              variant="outline"
            >
              {text.common.newer}
            </Button>
          ) : (
            <span />
          )}
          <span className="text-xs text-muted-foreground">
            {ar ? "صفحة" : "Page"} {current}
          </span>
          {hasNext ? (
            <Button
              render={
                <Link
                  href={localizedPath(
                    `${basePath}?page=${current + 1}`,
                    locale,
                  )}
                />
              }
              nativeButton={false}
              variant="outline"
            >
              {text.common.older}
            </Button>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </main>
  );
}
