import { ShieldIcon } from "lucide-react";
import Link from "next/link";
import { NewsList } from "@/components/admin/news-list";
import { getAdminAccess } from "@/lib/admin";
import { listAdminNewsPosts } from "@/lib/news";
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
  const posts = access.allowed ? listAdminNewsPosts() : [];

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
                Create, edit, publish, and delete posts below. Published posts
                appear on the matching game page. Discord publishing can connect next.
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

      {access.allowed ? (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="text-xl font-semibold">News &amp; posts</h2>
            <p className="text-sm text-muted-foreground">
              Draft, edit, publish, and remove the updates shown on game pages.
            </p>
          </div>
          <NewsList posts={posts} />
        </section>
      ) : null}
    </main>
  );
}
