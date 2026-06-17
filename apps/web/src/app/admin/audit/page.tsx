import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { listAuditLog } from "@/lib/audit";
import { getRequestLocale } from "@/lib/request-locale";
import { DateTime } from "@/components/date-time";
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

export default async function AdminAuditPage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/audit");
  if (!access.isSuper) redirect("/admin");
  const locale = await getRequestLocale();
  const t = getAdminCopy(locale);

  const entries = await listAuditLog(100);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-5 py-10 sm:px-8">
      <Button render={<Link href="/admin" />} nativeButton={false} variant="ghost" className="w-fit">
        <ArrowLeftIcon data-icon="inline-start" />
        {t.common.backToAdmin}
      </Button>
      <div>
        <p className="text-sm text-muted-foreground">{t.common.superAdmin}</p>
        <h1 className="text-3xl font-semibold leading-tight">{t.audit.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t.audit.description}
        </p>
      </div>

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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start">
                    <th className="pb-2 pe-4 font-medium text-muted-foreground">{t.audit.headers.time}</th>
                    <th className="pb-2 pe-4 font-medium text-muted-foreground">{t.audit.headers.actor}</th>
                    <th className="pb-2 pe-4 font-medium text-muted-foreground">{t.audit.headers.action}</th>
                    <th className="pb-2 font-medium text-muted-foreground">{t.audit.headers.target}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-b last:border-0">
                      <td className="py-2 pe-4 tabular-nums text-muted-foreground">
                        <DateTime value={entry.createdAt} locale={locale} />
                      </td>
                      <td className="py-2 pe-4">
                        <span className="font-medium">{entry.actorName ?? t.common.empty}</span>
                        <span className="ms-1 text-xs text-muted-foreground">
                          ({entry.actorId})
                        </span>
                      </td>
                      <td className="py-2 pe-4 font-mono text-xs">{entry.action}</td>
                      <td className="py-2 font-mono text-xs">{entry.target ?? t.common.empty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
