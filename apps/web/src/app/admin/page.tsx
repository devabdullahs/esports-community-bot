import { ShieldIcon } from "lucide-react";
import Link from "next/link";
import { NewsComposer } from "@/components/admin/news-composer";
import { getAdminAccess } from "@/lib/admin";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

export default async function AdminPage() {
  const access = await getAdminAccess();

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-5 py-10 sm:px-8">
      <section className="flex max-w-3xl flex-col gap-3">
        <p className="text-sm text-muted-foreground">Private workspace</p>
        <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">
          Admin publishing
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          A focused staff experience for drafting game news, checking the
          public preview, and preparing updates before they go to the community.
        </p>
      </section>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <ShieldIcon data-icon="inline-start" />
            <div>
              <CardTitle>Access</CardTitle>
              <CardDescription>
                Staff controls are private and hidden from public navigation.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {access.allowed ? (
            <Alert>
              <AlertTitle>Admin tools enabled</AlertTitle>
              <AlertDescription>
                You can draft and preview posts below. Persistence and Discord
                publishing can connect to this workflow next.
              </AlertDescription>
            </Alert>
          ) : !access.session ? (
            <Alert>
              <AlertTitle>Sign in required</AlertTitle>
              <AlertDescription className="flex flex-col gap-3">
                Staff tools are not shown to public users. Sign in with Discord
                to access admin workflows.
                <Button
                  render={<Link href="/login?callbackURL=/admin" />}
                  nativeButton={false}
                  className="w-fit"
                >
                  Sign in
                </Button>
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

      {access.allowed ? <NewsComposer /> : null}
    </main>
  );
}
