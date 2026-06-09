import {
  ArrowRightIcon,
  Gamepad2Icon,
  type LucideIcon,
  ShieldIcon,
  Tv2Icon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { NewsList } from "@/components/admin/news-list";
import { getAdminAccess } from "@/lib/admin";
import { listGames } from "@/lib/games";
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
  const allPosts = access.allowed ? listAdminNewsPosts() : [];
  const posts =
    access.games === "ALL" ? allPosts : allPosts.filter((p) => access.games.includes(p.gameSlug));
  const games = access.allowed ? listGames() : [];

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
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ManageLink
            href="/admin/games"
            icon={Gamepad2Icon}
            title="Game pages"
            description="Edit the games you manage."
          />
          <ManageLink
            href="/admin/media"
            icon={Tv2Icon}
            title="Media channels"
            description="Edit the media channels you manage."
          />
          {access.isSuper ? (
            <ManageLink
              href="/admin/team"
              icon={UsersIcon}
              title="Admin team"
              description="Add admins and assign their games & channels."
            />
          ) : null}
        </section>
      ) : null}

      {access.allowed ? (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="text-xl font-semibold">News &amp; posts</h2>
            <p className="text-sm text-muted-foreground">
              Draft, edit, publish, and remove the updates shown on game pages.
            </p>
          </div>
          <NewsList posts={posts} games={games} />
        </section>
      ) : null}
    </main>
  );
}

function ManageLink({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-1 rounded-lg border p-4 transition-colors hover:bg-muted/50"
    >
      <span className="flex items-center gap-2 font-semibold">
        <Icon className="size-4" />
        {title}
        <ArrowRightIcon className="ms-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
      </span>
      <span className="text-sm text-muted-foreground">{description}</span>
    </Link>
  );
}
