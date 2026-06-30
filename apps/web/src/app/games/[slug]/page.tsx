import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  Gamepad2Icon,
  NewspaperIcon,
  ShieldCheckIcon,
} from "lucide-react";
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
import { DateTime } from "@/components/date-time";
import { Separator } from "@/components/ui/separator";
import { localizeText } from "@/lib/community-content";
import { getGameCached } from "@/lib/games";
import {
  copy,
  localizedPath,
} from "@/lib/i18n";
import { listPublishedNewsPostsCached } from "@/lib/news";
import { getRequestLocale } from "@/lib/request-locale";
import { safeUrlOrUndefined } from "@/lib/safe-url";
import { canManageGame, getAdminAccess } from "@/lib/admin";
import { buildPageMetadata } from "@/lib/metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const [game, locale] = await Promise.all([getGameCached(slug), getRequestLocale()]);
  if (!game) return {};
  return buildPageMetadata({
    title: localizeText(game.title, locale),
    description: localizeText(game.description, locale),
    path: localizedPath(`/games/${slug}`, locale),
  });
}

export default async function GamePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const game = await getGameCached(slug);
  if (!game) notFound();

  const locale = await getRequestLocale();
  const text = copy[locale].game;
  const common = copy[locale].common;
  const access = await getAdminAccess();
  const posts = await listPublishedNewsPostsCached(slug, locale);

  return (
    <main
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-8 sm:px-8 sm:py-10"
    >
      <PageBreadcrumb
        items={[
          { label: common.home, href: localizedPath("/", locale) },
          { label: common.games, href: localizedPath("/games", locale) },
          { label: localizeText(game.title, locale) },
        ]}
      />
      <Button
        render={<Link href={localizedPath("/games", locale)} />}
        nativeButton={false}
        variant="ghost"
        className="w-fit"
      >
        <ArrowLeftIcon data-icon="inline-start" className="rtl:rotate-180" />
        {text.back}
      </Button>

      <section className="grid gap-8 lg:grid-cols-[1fr_22rem] lg:items-start">
        <div className="flex flex-col items-start gap-4">
          <Badge variant="outline">
            <Gamepad2Icon data-icon="inline-start" />
            {localizeText(game.status, locale)}
          </Badge>
          <div className="flex max-w-3xl flex-col gap-3">
            <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">
              {localizeText(game.title, locale)}
            </h1>
            <p className="text-sm leading-6 text-muted-foreground sm:text-base">
              {localizeText(game.description, locale)}
            </p>
          </div>
          {canManageGame(access, slug) ? (
            <Button
              render={<Link href={localizedPath("/admin", locale)} />}
              nativeButton={false}
              variant="outline"
            >
              <ShieldCheckIcon data-icon="inline-start" />
              {text.admin}
              <ArrowRightIcon data-icon="inline-end" className="rtl:rotate-180" />
            </Button>
          ) : null}
        </div>

        <Card size="sm">
          <CardHeader>
            <CardTitle>{text.owner}</CardTitle>
            <CardDescription>{localizeText(game.owner, locale)}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col">
            {game.focus.map((item, index) => (
              <div key={localizeText(item, locale)}>
                {index > 0 ? <Separator /> : null}
                <p className="py-3 text-sm">{localizeText(item, locale)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">{text.postsTitle}</h2>
        {posts.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {posts.map((post) => {
              const cover = safeUrlOrUndefined(post.coverImageUrl);

              return (
                <Link
                  key={post.id}
                  href={localizedPath(`/games/${slug}/news/${post.id}`, locale)}
                  className="group block"
                >
                  <Card className="h-full overflow-hidden ring-1 ring-transparent transition-all group-hover:-translate-y-0.5 group-hover:border-primary/30 group-hover:shadow-md group-hover:ring-primary/40">
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element -- external/admin URL, validated http(s)
                      <img
                        src={cover}
                        alt=""
                        className="aspect-video w-full object-cover"
                      />
                    ) : null}
                    <CardHeader>
                      <Badge variant="secondary" className="mb-2 w-fit">
                        <NewspaperIcon data-icon="inline-start" />
                        {post.publishedAt ? <DateTime value={post.publishedAt} locale={locale} /> : text.published}
                      </Badge>
                      <CardTitle dir="auto">{post.title}</CardTitle>
                      {post.summary ? (
                        <CardDescription dir="auto" className="article-copy news-card-summary">
                          {post.summary}
                        </CardDescription>
                      ) : null}
                    </CardHeader>
                  </Card>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{text.postsEmpty}</p>
        )}
      </section>
    </main>
  );
}
