import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRightIcon,
  Gamepad2Icon,
  MessageSquareIcon,
  NewspaperIcon,
  SparklesIcon,
} from "lucide-react";
import { GameLogoMark } from "@/components/game-logo-mark";
import { PageBreadcrumb } from "@/components/page-breadcrumb";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { localizeText } from "@/lib/community-content";
import { gameTitleForSlug, listGamesCached } from "@/lib/games";
import { listLatestPublishedNewsPostsCached } from "@/lib/news";
import {
  copy,
  localizedPath,
} from "@/lib/i18n";
import { buildPageMetadata } from "@/lib/metadata";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const text = copy[locale].games;
  return buildPageMetadata({
    title: text.title,
    description: text.description,
    path: localizedPath("/games", locale),
    locale,
  });
}

export default async function GamesPage() {
  const locale = await getRequestLocale();
  const text = copy[locale].games;
  const common = copy[locale].common;
  const games = await listGamesCached();
  const latestPosts = await listLatestPublishedNewsPostsCached(locale, 2);
  const gameTitle = (slug: string) => gameTitleForSlug(slug, games, locale);
  const numberFormatter = new Intl.NumberFormat(locale === "ar" ? "ar-SA" : "en-US");
  const formatNumber = (value: number) => numberFormatter.format(value);
  const ui =
    locale === "ar"
      ? {
          directory: "\u062f\u0644\u064a\u0644 \u0627\u0644\u0623\u0644\u0639\u0627\u0628",
          supportedGames: "\u0623\u0644\u0639\u0627\u0628 \u0645\u062f\u0639\u0648\u0645\u0629",
          discordChannels: "\u0642\u0646\u0648\u0627\u062a \u062f\u064a\u0633\u0643\u0648\u0631\u062f",
          latestUpdates: "\u0622\u062e\u0631 \u0627\u0644\u062a\u062d\u062f\u064a\u062b\u0627\u062a",
          trackingFocus: "\u0645\u062c\u0627\u0644\u0627\u062a \u0627\u0644\u062a\u062a\u0628\u0639",
          managedBy: "\u0627\u0644\u0645\u0633\u0624\u0648\u0644",
          activeDirectory:
            "\u062a\u0635\u0641\u062d \u0623\u0644\u0639\u0627\u0628 \u0627\u0644\u0645\u062c\u062a\u0645\u0639\u060c \u0642\u0646\u0648\u0627\u062a\u0647\u0627\u060c \u0648\u0623\u062e\u0631 \u0627\u0644\u062a\u062d\u062f\u064a\u062b\u0627\u062a.",
        }
      : {
          directory: "Game directory",
          supportedGames: "Supported games",
          discordChannels: "Discord channels",
          latestUpdates: "Latest updates",
          trackingFocus: "Tracking focus",
          managedBy: "Managed by",
          activeDirectory:
            "Browse the community's games, channels, and latest updates.",
        };
  const gamesWithChannels = games.filter((game) => game.discordChannelId).length;
  const stats = [
    {
      label: ui.supportedGames,
      value: games.length,
      icon: Gamepad2Icon,
    },
    {
      label: ui.discordChannels,
      value: gamesWithChannels,
      icon: MessageSquareIcon,
    },
    {
      label: ui.latestUpdates,
      value: latestPosts.length,
      icon: NewspaperIcon,
    },
  ];

  return (
    <main
      className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-8 sm:px-8 sm:py-10"
    >
      <PageBreadcrumb
        items={[
          { label: common.home, href: localizedPath("/", locale) },
          { label: common.games },
        ]}
      />
      <section className="overflow-hidden rounded-2xl border bg-card/35 p-5 shadow-sm sm:rounded-3xl sm:p-8">
        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
          <div className="flex max-w-3xl flex-col items-start gap-4">
            <Badge variant="outline" className="border-primary/35 bg-primary/10 text-primary">
              <Gamepad2Icon data-icon="inline-start" />
              {text.eyebrow}
            </Badge>
            <div className="flex flex-col gap-3">
              <h1 className="text-3xl font-semibold leading-tight sm:text-5xl">
                {text.title}
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                {text.description}
              </p>
            </div>
            <Link
              href="#games-directory"
              className="inline-flex items-center gap-2 text-sm font-medium text-primary transition-colors hover:text-primary/80"
            >
              {ui.directory}
              <ArrowRightIcon data-icon="inline-end" className="size-4 rtl:rotate-180" />
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            {stats.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className="rounded-2xl border bg-background/35 p-4"
                >
                  <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <Icon className="size-3.5 text-primary" />
                    <span className="truncate">{item.label}</span>
                  </div>
                  <div className="text-3xl font-semibold leading-none">
                    {formatNumber(item.value)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section
        id="games-directory"
        className="grid scroll-mt-24 gap-4 md:grid-cols-2 xl:grid-cols-3"
      >
        {games.map((game) => (
          <Link
            key={game.slug}
            href={localizedPath(`/games/${game.slug}`, locale)}
            className="group block"
          >
            <Card size="sm" className="h-full overflow-hidden ring-1 ring-transparent transition-all group-hover:-translate-y-0.5 group-hover:border-primary/30 group-hover:shadow-md group-hover:ring-primary/35">
              <CardHeader className="gap-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <GameLogoMark
                      slug={game.slug}
                      label={localizeText(game.title, locale)}
                      className="size-14 rounded-2xl"
                      iconClassName="size-8"
                    />
                    <div className="min-w-0">
                      <Badge variant="secondary" className="mb-2 w-fit">
                        <SparklesIcon data-icon="inline-start" />
                        {localizeText(game.status, locale)}
                      </Badge>
                      <CardTitle className="line-clamp-2 text-lg">
                        {localizeText(game.title, locale)}
                      </CardTitle>
                    </div>
                  </div>
                  <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border text-muted-foreground transition-colors group-hover:border-primary/40 group-hover:text-primary">
                    <ArrowRightIcon className="size-4 rtl:rotate-180" />
                  </span>
                </div>
                <CardDescription className="line-clamp-3 leading-6">
                  {localizeText(game.description, locale)}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">
                    {ui.trackingFocus}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {game.focus.map((item) => (
                      <Badge key={localizeText(item, locale)} variant="outline">
                        {localizeText(item, locale)}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-xs text-muted-foreground">
                  <span className="min-w-0 truncate">
                    {ui.managedBy}: {localizeText(game.owner, locale)}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 font-medium text-primary">
                    {text.openGame}
                    <ArrowRightIcon className="size-3.5 rtl:rotate-180" />
                  </span>
                </div>
              </CardContent>
            </Card>
          </Link>
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
                  <Card size="sm" className="h-full ring-1 ring-transparent transition-all group-hover:-translate-y-0.5 group-hover:border-primary/30 group-hover:shadow-md group-hover:ring-primary/40">
                    <CardHeader>
                      <div className="mb-2 flex items-center gap-2">
                        <GameLogoMark
                          slug={post.gameSlug}
                          label={gameTitle(post.gameSlug ?? "")}
                          className="size-8 rounded-xl"
                          iconClassName="size-4"
                        />
                        <Badge variant="secondary" className="w-fit">
                          {gameTitle(post.gameSlug ?? "")}
                        </Badge>
                      </div>
                      <CardTitle dir="auto">{post.title}</CardTitle>
                      {post.summary ? (
                        <CardDescription dir="auto" className="article-copy line-clamp-2">
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
