import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  Gamepad2Icon,
  NewspaperIcon,
  ShieldCheckIcon,
} from "lucide-react";
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
import {
  communityGames,
  getCommunityGame,
  localizeText,
} from "@/lib/community-content";
import {
  copy,
  directionForLocale,
  localeFromSearchParams,
  localizedPath,
} from "@/lib/i18n";
import { getAuthSession } from "@/lib/session";

export function generateStaticParams() {
  return communityGames.map((game) => ({ slug: game.slug }));
}

export default async function GamePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { slug } = await params;
  const game = getCommunityGame(slug);
  if (!game) notFound();

  const locale = localeFromSearchParams(await searchParams);
  const text = copy[locale].game;
  const session = await getAuthSession();

  return (
    <main
      lang={locale}
      dir={directionForLocale(locale)}
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-5 py-10 sm:px-8"
    >
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
          {session ? (
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

      <section className="grid gap-4 md:grid-cols-2">
        {game.posts.map((post) => (
          <Card key={localizeText(post.title, locale)}>
            <CardHeader>
              <Badge variant="secondary" className="mb-2 w-fit">
                <NewspaperIcon data-icon="inline-start" />
                {localizeText(post.label, locale)}
              </Badge>
              <CardTitle>{localizeText(post.title, locale)}</CardTitle>
              <CardDescription className="article-copy">
                {localizeText(post.summary, locale)}
              </CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>
    </main>
  );
}
