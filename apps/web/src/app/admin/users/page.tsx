import Link from "next/link";
import { redirect } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { listCommunityUsers } from "@/lib/community-users";
import { getRequestLocale } from "@/lib/request-locale";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
    <AdminPageShell
      maxWidth="6xl"
      backHref="/admin"
      backLabel={t.common.backToAdmin}
      eyebrow={t.common.superAdmin}
      title={t.users.title}
      description={t.users.description}
    >
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.users.headers.member}</TableHead>
                  <TableHead>{t.users.headers.discordId}</TableHead>
                  <TableHead>{t.users.headers.joined}</TableHead>
                  <TableHead>{t.users.headers.lastActive}</TableHead>
                  <TableHead className="tabular-nums">{t.users.headers.comments}</TableHead>
                  <TableHead className="tabular-nums">{t.users.headers.likes}</TableHead>
                  <TableHead>{t.users.headers.status}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const rowInner = (
                    <span className="flex items-center gap-2">
                      <AuthorAvatar name={u.name ?? ""} avatarUrl={u.image} className="size-7" />
                      <span className="font-medium">{u.name ?? t.users.nameFallback}</span>
                    </span>
                  );
                  return (
                    <TableRow key={u.authUserId}>
                      <TableCell>
                        {u.discordUserId ? (
                          <Link href={`/admin/users/${u.discordUserId}`} className="hover:underline">
                            {rowInner}
                          </Link>
                        ) : (
                          rowInner
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground" dir="ltr">
                        {u.discordUserId ?? t.common.empty}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        <DateTime value={u.createdAt} locale={locale} />
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {u.lastActivityAt ? <DateTime value={u.lastActivityAt} locale={locale} /> : t.users.detail.never}
                      </TableCell>
                      <TableCell className="tabular-nums">{u.commentCount}</TableCell>
                      <TableCell className="tabular-nums">{u.likeCount}</TableCell>
                      <TableCell>
                        <span className="flex flex-wrap gap-1.5">
                          {u.ewcLinked ? <Badge variant="secondary">{t.users.ewcLinkedBadge}</Badge> : null}
                          {u.blocked ? <Badge variant="destructive">{t.users.blockedBadge}</Badge> : null}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
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
    </AdminPageShell>
  );
}
