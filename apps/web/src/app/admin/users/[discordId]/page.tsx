import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeftIcon,
  CalendarDaysIcon,
  HeartIcon,
  type LucideIcon,
  MessagesSquareIcon,
} from "lucide-react";
import { getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { getCommunityUserDetail } from "@/lib/community-users";
import { getRequestLocale } from "@/lib/request-locale";
import { UserModeration } from "@/components/admin/user-moderation";
import { AuthorAvatar } from "@/components/news/author-avatar";
import { DateTime } from "@/components/date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ discordId: string }>;
}) {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/users");
  if (!access.isSuper) redirect("/admin");
  const locale = await getRequestLocale();
  const t = getAdminCopy(locale);

  const { discordId } = await params;
  const detail = await getCommunityUserDetail(discordId);
  if (!detail) notFound();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8 sm:py-10">
      <Button render={<Link href="/admin/users" />} nativeButton={false} variant="ghost" className="w-fit">
        <ArrowLeftIcon data-icon="inline-start" />
        {t.users.title}
      </Button>

      <div className="flex flex-wrap items-center gap-4">
        <AuthorAvatar name={detail.name ?? ""} avatarUrl={detail.image} className="size-14" />
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold leading-tight">{detail.name ?? t.users.nameFallback}</h1>
          <p className="font-mono text-xs text-muted-foreground" dir="ltr">{detail.discordUserId}</p>
          <p className="text-xs text-muted-foreground">
            {t.users.detail.joined}: <DateTime value={detail.createdAt} locale={locale} />
          </p>
          <div className="flex flex-wrap gap-1.5">
            {detail.ewcLinked ? <Badge variant="secondary">{t.users.ewcLinkedBadge}</Badge> : null}
            {detail.block ? <Badge variant="destructive">{t.users.blockedBadge}</Badge> : null}
          </div>
        </div>
      </div>

      {detail.block ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-base">{t.users.block.blockedTitle}</CardTitle>
            <CardDescription className="flex flex-col gap-0.5">
              <span>
                {t.users.block.blockedBy}: {detail.block.blockedByName ?? detail.block.blockedBy}{" "}
                (<DateTime value={detail.block.createdAt} locale={locale} />)
              </span>
              {detail.block.reason ? (
                <span>
                  {t.users.block.blockedReason}: {detail.block.reason}
                </span>
              ) : null}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <section>
        <h2 className="mb-2 text-lg font-semibold">{t.users.detail.activityTitle}</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label={t.users.detail.comments} value={String(detail.commentCount)} icon={MessagesSquareIcon} />
          <StatCard label={t.users.detail.likes} value={String(detail.likeCount)} icon={HeartIcon} />
          <StatCard
            label={t.users.detail.lastActive}
            value={detail.lastActivityAt ?? t.users.detail.never}
            icon={CalendarDaysIcon}
          />
        </div>
      </section>

      <UserModeration
        discordId={detail.discordUserId}
        blocked={Boolean(detail.block)}
        comments={detail.comments}
        locale={locale}
      />
    </main>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon?: LucideIcon;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardDescription>{label}</CardDescription>
          {Icon ? <Icon className="text-muted-foreground" /> : null}
        </div>
        <CardTitle className="text-2xl font-semibold leading-none tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
