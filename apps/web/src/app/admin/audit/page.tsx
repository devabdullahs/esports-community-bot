import { redirect } from "next/navigation";
import { getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { listAuditLog } from "@/lib/audit";
import { getRequestLocale } from "@/lib/request-locale";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { DateTime } from "@/components/date-time";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

export default async function AdminAuditPage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/audit");
  if (!access.isSuper) redirect("/admin");
  const locale = await getRequestLocale();
  const t = getAdminCopy(locale);

  const entries = await listAuditLog(100);

  return (
    <AdminPageShell
      maxWidth="5xl"
      breadcrumbs={[
        { label: t.dashboard.title, href: "/admin" },
        { label: t.audit.title },
      ]}
      eyebrow={t.common.superAdmin}
      title={t.audit.title}
      description={t.audit.description}
    >
      <Card>
        <CardHeader>
          <CardTitle>{t.audit.recentTitle}</CardTitle>
          <CardDescription>
            {t.audit.recentDescription}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.audit.empty}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.audit.headers.time}</TableHead>
                  <TableHead>{t.audit.headers.actor}</TableHead>
                  <TableHead>{t.audit.headers.action}</TableHead>
                  <TableHead>{t.audit.headers.target}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="tabular-nums text-muted-foreground">
                      <DateTime value={entry.createdAt} locale={locale} />
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{entry.actorName ?? t.common.empty}</span>
                      <span className="ms-1 text-xs text-muted-foreground">
                        ({entry.actorId})
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{entry.action}</TableCell>
                    <TableCell className="font-mono text-xs">{entry.target ?? t.common.empty}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AdminPageShell>
  );
}
