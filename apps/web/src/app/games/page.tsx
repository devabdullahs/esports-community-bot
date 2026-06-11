import Link from "next/link";
import { ArrowRightIcon, Gamepad2Icon, NewspaperIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { localizeText } from "@/lib/community-content";
import { listGamesCached } from "@/lib/games";
import { listLatestPublishedNewsPostsCached } from "@/lib/news";
import {
  copy,
  localizedPath,
} from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function GamesPage() {
  const locale = await getRequestLocale();
  const text = copy[locale].games;
  const games = await listGamesCached();
  const latestPosts = await listLatestPublishedNewsPostsCached(locale, 2);
  const gameTitle = (slug: string) => {
    const game = games.find((g) => g.slug === slug);
    return game ? localizeText(game.title, locale) : slug;
  };

  return (
    <main
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-5 py-10 sm:px-8"
    >
      <section className="flex max-w-3xl flex-col items-start gap-4">
        <Badge variant="outline">
          <Gamepad2Icon data-icon="inline-start" />
          {text.eyebrow}
        </Badge>
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">
            {text.title}
          </h1>
          <p className="text-sm leading-6 text-muted-foreground sm:text-base">
            {text.description}
          </p>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {games.map((game) => (
          <Card key={game.slug} size="sm" className="h-full">
            <CardHeader>
              <Badge variant="secondary" className="mb-2 w-fit">
                {localizeText(game.status, locale)}
              </Badge>
              <CardTitle>{localizeText(game.title, locale)}</CardTitle>
              <CardDescription>
                {localizeText(game.description, locale)}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                {game.focus.map((item) => (
                  <Badge key={localizeText(item, locale)} variant="outline">
                    {localizeText(item, locale)}
                  </Badge>
                ))}
              </div>
              <Button
                render={<Link href={localizedPath(`/games/${game.slug}`, locale)} />}
                nativeButton={false}
                variant="outline"
                size="sm"
                className="mt-auto w-full"
              >
                {text.openGame}
                <ArrowRightIcon
                  data-icon="inline-end"
                  className="rtl:rotate-180"
                />
              </Button>
            </CardContent>
          </Card>
        ))}
      </section>

      {latestPosts.length ? (
        <section className="border-t pt-10">
          <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
            <div className="flex flex-col gap-3">
              <Badge variant="outline" className="w-fit">
                <NewspaperIcon data-icon="inline-start" />
                {text.newsLabel}
              </Badge>
              <h2 className="text-2xl font-semibold leading-tight">
                {text.newsTitle}
              </h2>
              <p className="text-sm leading-6 text-muted-foreground">
                {text.newsDescription}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {latestPosts.map((post) => (
                <Link
                  key={post.id}
                  href={localizedPath(`/games/${post.gameSlug}/news/${post.id}`, locale)}
                  className="group block"
                >
                  <Card size="sm" className="h-full transition-[box-shadow] group-hover:shadow-md group-hover:ring-primary/40">
                    <CardHeader>
                      <Badge variant="secondary" className="mb-2 w-fit">
                        {gameTitle(post.gameSlug)}
                      </Badge>
                      <CardTitle>{post.title}</CardTitle>
                      {post.summary ? (
                        <CardDescription className="article-copy line-clamp-2">
                          {post.summary}
                        </CardDescription>
                      ) : null}
                    </CardHeader>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
