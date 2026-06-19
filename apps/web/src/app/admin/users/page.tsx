import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon, SearchIcon } from "lucide-react";
import { getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { listCommunityUsers } from "@/lib/community-users";
import { getRequestLocale } from "@/lib/request-locale";
import { AuthorAvatar } from "@/components/news/author-avatar";
import { DateTime } from "@/components/date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/users");
  if (!access.isSuper) redirect("/admin");
  const locale = await getRequestLocale();
  const t = getAdminCopy(locale);

  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const { users, total } = await listCommunityUsers({ search: q, limit: PAGE_SIZE, offset });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (p: number) =>
    `/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) }).toString()}`;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-5 py-10 sm:px-8">
      <Button render={<Link href="/admin" />} nativeButton={false} variant="ghost" className="w-fit">
        <ArrowLeftIcon data-icon="inline-start" />
        {t.common.backToAdmin}
      </Button>
      <div>
        <p className="text-sm text-muted-foreground">{t.common.superAdmin}</p>
        <h1 className="text-3xl font-semibold leading-tight">{t.users.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t.users.description}</p>
      </div>

      <form method="get" className="flex max-w-md gap-2">
        <Input name="q" defaultValue={q} placeholder={t.users.searchPlaceholder} aria-label={t.users.searchPlaceholder} />
        <Button type="submit" variant="outline">
          <SearchIcon data-icon="inline-start" />
          {t.users.searchAction}
        </Button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>{t.users.title}</CardTitle>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.users.empty}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start">
                    <th className="pb-2 pe-4 font-medium text-muted-foreground">{t.users.headers.member}</th>
                    <th className="pb-2 pe-4 font-medium text-muted-foreground">{t.users.headers.discordId}</th>
                    <th className="pb-2 pe-4 font-medium text-muted-foreground">{t.users.headers.joined}</th>
                    <th className="pb-2 pe-4 font-medium text-muted-foreground">{t.users.headers.lastActive}</th>
                    <th className="pb-2 pe-4 font-medium text-muted-foreground tabular-nums">{t.users.headers.comments}</th>
                    <th className="pb-2 pe-4 font-medium text-muted-foreground tabular-nums">{t.users.headers.likes}</th>
                    <th className="pb-2 font-medium text-muted-foreground">{t.users.headers.status}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const rowInner = (
                      <>
                        <span className="flex items-center gap-2">
                          <AuthorAvatar name={u.name ?? ""} avatarUrl={u.image} className="size-7" />
                          <span className="font-medium">{u.name ?? t.users.nameFallback}</span>
                        </span>
                      </>
                    );
                    return (
                      <tr key={u.authUserId} className="border-b last:border-0 hover:bg-muted/40">
                        <td className="py-2 pe-4">
                          {u.discordUserId ? (
                            <Link href={`/admin/users/${u.discordUserId}`} className="hover:underline">
                              {rowInner}
                            </Link>
                          ) : (
                            rowInner
                          )}
                        </td>
                        <td className="py-2 pe-4 font-mono text-xs text-muted-foreground" dir="ltr">
                          {u.discordUserId ?? t.common.empty}
                        </td>
                        <td className="py-2 pe-4 tabular-nums text-muted-foreground">
                          <DateTime value={u.createdAt} locale={locale} />
                        </td>
                        <td className="py-2 pe-4 tabular-nums text-muted-foreground">
                          {u.lastActivityAt ? <DateTime value={u.lastActivityAt} locale={locale} /> : t.users.detail.never}
                        </td>
                        <td className="py-2 pe-4 tabular-nums">{u.commentCount}</td>
                        <td className="py-2 pe-4 tabular-nums">{u.likeCount}</td>
                        <td className="py-2">
                          <span className="flex flex-wrap gap-1.5">
                            {u.ewcLinked ? <Badge variant="secondary">{t.users.ewcLinkedBadge}</Badge> : null}
                            {u.blocked ? <Badge variant="destructive">{t.users.blockedBadge}</Badge> : null}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between">
          <Button
            render={<Link href={pageHref(page - 1)} />}
            nativeButton={false}
            variant="outline"
            size="sm"
            disabled={page <= 1}
          >
            {t.users.previous}
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums">
            {page} / {totalPages}
          </span>
          <Button
            render={<Link href={pageHref(page + 1)} />}
            nativeButton={false}
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
          >
            {t.users.next}
          </Button>
        </div>
      ) : null}
    </main>
  );
}
