import Link from "next/link";
import { redirect } from "next/navigation";
import { PenLineIcon, Tv2Icon } from "lucide-react";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { canManageMedia, getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { localizeText } from "@/lib/community-content";
import { localizedPath } from "@/lib/i18n";
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
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

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
    redirect(
      localizedPath(`/admin/news/new?media=${encodeURIComponent(channels[0].slug)}`, locale),
    );
  }

  return (
    <AdminPageShell
      breadcrumbs={[
        { label: t.dashboard.title, href: "/admin" },
        { label: t.media.title, href: "/admin/media" },
        { label: t.media.newPostTitle },
      ]}
      eyebrow={t.common.channelPublishing}
      title={t.media.newPostTitle}
      description={t.media.newPostDescription}
      maxWidth="5xl"
      actions={
        <Button render={<Link href="/admin/media" />} nativeButton={false} variant="outline">
          <Tv2Icon data-icon="inline-start" />
          {t.dashboard.links.mediaTitle}
        </Button>
      }
    >
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
                        href={localizedPath(
                          `/admin/news/new?media=${encodeURIComponent(channel.slug)}`,
                          locale,
                        )}
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
        <Empty className="border border-dashed border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Tv2Icon />
            </EmptyMedia>
            <EmptyTitle>{t.media.empty}</EmptyTitle>
            <EmptyDescription>{t.media.noAssignedChannels}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </AdminPageShell>
  );
}
