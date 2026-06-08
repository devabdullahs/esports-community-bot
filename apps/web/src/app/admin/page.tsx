import { ShieldIcon } from "lucide-react";
import { getAdminAccess } from "@/lib/admin";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const access = await getAdminAccess();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-8">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <ShieldIcon data-icon="inline-start" />
            <div>
              <CardTitle>Admin</CardTitle>
              <CardDescription>Foundation route for future dashboard management tools.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {access.allowed ? (
            <Alert>
              <AlertTitle>No admin tools are enabled yet</AlertTitle>
              <AlertDescription>
                This route is reserved for future EWC data management that will feed the Discord bot.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <AlertTitle>Admin access is not active</AlertTitle>
              <AlertDescription>
                Add Discord user IDs to `EWC_DASHBOARD_ADMIN_DISCORD_IDS` before enabling dashboard management tools.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
