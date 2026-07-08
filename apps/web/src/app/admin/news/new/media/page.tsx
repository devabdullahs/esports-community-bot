import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon, PenLineIcon, Tv2Icon } from "lucide-react";
import { canManageMedia, getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { localizeText } from "@/lib/community-content";
import { listMediaChannels } from "@/lib/media";
import { getRequestLocale } from "@/lib/request-locale";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NewMediaPostPage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/news/new/media");
  if (!access.allowed) redirect("/admin");

  const locale = await getRequestLocale();
  const t = getAdminCopy(locale);
  const channels = (await listMediaChannels()).filter((channel) =>
    canManageMedia(access, channel.slug),
  );

  if (channels.length === 1) {
    redirect(`/admin/news/new?media=${encodeURIComponent(channels[0].slug)}`);
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8 sm:py-10">
      <Button
        render={<Link href="/admin" />}
        nativeButton={false}
        variant="ghost"
        className="w-fit"
      >
        <ArrowLeftIcon data-icon="inline-start" />
        {t.common.backToAdmin}
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {t.common.channelPublishing}
          </p>
          <h1 className="text-3xl font-semibold leading-tight">
            {t.media.newPostTitle}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {t.media.newPostDescription}
          </p>
        </div>
        <Button
          render={<Link href="/admin/media" />}
          nativeButton={false}
          variant="outline"
          className="w-full sm:w-auto"
        >
          <Tv2Icon data-icon="inline-start" />
          {t.dashboard.links.mediaTitle}
        </Button>
      </div>

      {channels.length ? (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {channels.map((channel) => {
            const name = localizeText(channel.name, locale);
            return (
              <Card
                key={channel.slug}
                className="border-border/70 bg-card/70 shadow-sm"
              >
                <CardHeader className="gap-3 p-4 sm:p-5">
                  <span className="flex size-10 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                    <Tv2Icon className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <CardTitle className="truncate text-lg">{name}</CardTitle>
                    <CardDescription className="mt-1 font-mono text-xs">
                      /media/{channel.slug}
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4 pt-0 sm:px-5 sm:pb-5">
                  <Button
                    render={
                      <Link
                        href={`/admin/news/new?media=${encodeURIComponent(channel.slug)}`}
                      />
                    }
                    nativeButton={false}
                    className="w-full"
                  >
                    <PenLineIcon data-icon="inline-start" />
                    {t.media.newPostAction}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </section>
      ) : (
        <Card className="border-border/70 bg-card/70 shadow-sm">
          <CardHeader>
            <CardTitle>{t.media.empty}</CardTitle>
            <CardDescription>{t.media.noAssignedChannels}</CardDescription>
          </CardHeader>
        </Card>
      )}
    </main>
  );
}
