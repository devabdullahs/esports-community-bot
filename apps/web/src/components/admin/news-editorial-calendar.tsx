"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarClockIcon, Clock3Icon, PencilIcon } from "lucide-react";
import { localizedPath, type Locale } from "@/lib/i18n";
import {
  formatScheduledPublishAt,
  riyadhDayKey,
  scheduledCalendarDate,
} from "@/lib/scheduled-publishing";
import type { GameRecord } from "@/lib/games";
import type { NewsPost } from "@/lib/news";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type ScheduledPost = NewsPost & { scheduledPublishAt: string };

function dayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function NewsEditorialCalendar({
  posts,
  games,
  locale,
}: {
  posts: NewsPost[];
  games: GameRecord[];
  locale: Locale;
}) {
  const scheduled = useMemo(
    () =>
      posts
        .filter(
          (post): post is ScheduledPost =>
            post.status === "scheduled" && typeof post.scheduledPublishAt === "string",
        )
        .sort((a, b) => a.scheduledPublishAt.localeCompare(b.scheduledPublishAt)),
    [posts],
  );
  const days = useMemo(
    () =>
      scheduled
        .map((post) => scheduledCalendarDate(post.scheduledPublishAt))
        .filter((date): date is Date => Boolean(date)),
    [scheduled],
  );
  const [selected, setSelected] = useState<Date | undefined>(days[0]);
  const selectedKey = selected ? dayKey(selected) : null;
  const selectedPosts = selectedKey
    ? scheduled.filter((post) => riyadhDayKey(post.scheduledPublishAt) === selectedKey)
    : [];
  const gameNames = new Map(games.map((game) => [game.slug, game.title]));
  const text =
    locale === "ar"
      ? {
          calendar: "\u0627\u0644\u062a\u0642\u0648\u064a\u0645",
          list: "\u0627\u0644\u0642\u0627\u0626\u0645\u0629",
          empty: "\u0644\u0627 \u062a\u0648\u062c\u062f \u0645\u0646\u0634\u0648\u0631\u0627\u062a \u0645\u062c\u062f\u0648\u0644\u0629 \u0636\u0645\u0646 \u0646\u0637\u0627\u0642\u0643.",
          selected: "\u0645\u0646\u0634\u0648\u0631\u0627\u062a \u0645\u062c\u062f\u0648\u0644\u0629",
          timeZone: "\u062c\u0645\u064a\u0639 \u0627\u0644\u0623\u0648\u0642\u0627\u062a \u0628\u062a\u0648\u0642\u064a\u062a \u0627\u0644\u0631\u064a\u0627\u0636.",
          media: "\u0625\u0639\u0644\u0627\u0645",
          game: "\u0644\u0639\u0628\u0629",
          edit: "\u062a\u0639\u062f\u064a\u0644",
        }
      : {
          calendar: "Calendar",
          list: "List",
          empty: "No scheduled posts are in your scope.",
          selected: "Scheduled posts",
          timeZone: "All times are Asia/Riyadh.",
          media: "Media",
          game: "Game",
          edit: "Edit",
        };

  function owner(post: ScheduledPost) {
    if (post.mediaSlug) return `${text.media}: ${post.mediaSlug}`;
    const game = post.gameSlug ? gameNames.get(post.gameSlug) : null;
    const title = game?.[locale] || game?.en || post.gameSlug || "";
    return `${text.game}: ${title}`;
  }

  function postRow(post: ScheduledPost) {
    return (
      <article key={post.id} className="flex min-w-0 items-start gap-3 border-b border-border/70 py-3 last:border-b-0">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
          <CalendarClockIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{post.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Clock3Icon className="size-3" />
              {formatScheduledPublishAt(post.scheduledPublishAt, locale)}
            </span>
            <span>{owner(post)}</span>
          </div>
        </div>
        <Button
          render={<Link href={localizedPath(`/admin/news/${post.id}`, locale)} />}
          nativeButton={false}
          variant="ghost"
          size="icon-sm"
          aria-label={text.edit}
          title={text.edit}
        >
          <PencilIcon />
        </Button>
      </article>
    );
  }

  if (scheduled.length === 0) {
    return <p className="border border-dashed p-6 text-sm text-muted-foreground">{text.empty}</p>;
  }

  return (
    <Tabs defaultValue="calendar" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="calendar">{text.calendar}</TabsTrigger>
          <TabsTrigger value="list">{text.list}</TabsTrigger>
        </TabsList>
        <Badge variant="outline">{text.timeZone}</Badge>
      </div>
      <TabsContent value="calendar" className="grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)]">
        <div className="w-fit border border-border/70 p-2">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={setSelected}
            modifiers={{ scheduled: days }}
            modifiersClassNames={{ scheduled: "after:absolute after:bottom-1 after:size-1 after:rounded-full after:bg-primary" }}
          />
        </div>
        <section className="min-w-0">
          <h2 className="text-base font-semibold">{text.selected}</h2>
          <div className="mt-2">
            {selectedPosts.length ? selectedPosts.map(postRow) : <p className="text-sm text-muted-foreground">{text.empty}</p>}
          </div>
        </section>
      </TabsContent>
      <TabsContent value="list">
        <div>{scheduled.map(postRow)}</div>
      </TabsContent>
    </Tabs>
  );
}
