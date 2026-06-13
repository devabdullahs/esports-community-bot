import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { getAdminAccess } from "@/lib/admin";
import { listAuditLog } from "@/lib/audit";
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

  const entries = await listAuditLog(100);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-5 py-10 sm:px-8">
      <Button render={<Link href="/admin" />} nativeButton={false} variant="ghost" className="w-fit">
        <ArrowLeftIcon data-icon="inline-start" />
        Back to admin
      </Button>
      <div>
        <p className="text-sm text-muted-foreground">Super admin</p>
        <h1 className="text-3xl font-semibold leading-tight">Audit log</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The 100 most recent dashboard mutations. Read-only; pagination is deferred.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>
            Every successful admin write is recorded here with the actor, action, and target.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No audit entries yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">Time</th>
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">Actor</th>
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">Action</th>
                    <th className="pb-2 font-medium text-muted-foreground">Target</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                        {entry.createdAt}
                      </td>
                      <td className="py-2 pr-4">
                        <span className="font-medium">{entry.actorName ?? "—"}</span>
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({entry.actorId})
                        </span>
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs">{entry.action}</td>
                      <td className="py-2 font-mono text-xs">{entry.target ?? "—"}</td>
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
