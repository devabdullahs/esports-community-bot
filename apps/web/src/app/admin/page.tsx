import {
  ArrowRightIcon,
  ClipboardListIcon,
  Gamepad2Icon,
  type LucideIcon,
  MessagesSquareIcon,
  ShieldIcon,
  Tv2Icon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { NewsList } from "@/components/admin/news-list";
import { canManageGame, canManageMedia, getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { listGames } from "@/lib/games";
import { listAdminNewsPosts } from "@/lib/news";
import { getRequestLocale } from "@/lib/request-locale";
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
  const locale = await getRequestLocale();
  const t = getAdminCopy(locale);
  const allPosts = access.allowed ? await listAdminNewsPosts() : [];
  // Show a post if the admin manages its owner (game or media channel).
  const posts = allPosts.filter((p) =>
    p.mediaSlug
      ? canManageMedia(access, p.mediaSlug)
      : p.gameSlug
        ? canManageGame(access, p.gameSlug)
        : false,
  );
  const games = access.allowed ? await listGames() : [];

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-5 py-10 sm:px-8">
      <section className="flex max-w-3xl flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t.dashboard.eyebrow}</p>
        <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">
          {t.dashboard.title}
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          {t.dashboard.description}
        </p>
      </section>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <ShieldIcon data-icon="inline-start" />
            <div>
              <CardTitle>{t.dashboard.accessTitle}</CardTitle>
              <CardDescription>
                {t.dashboard.accessDescription}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {access.allowed ? (
            <Alert>
              <AlertTitle>{t.dashboard.toolsTitle}</AlertTitle>
              <AlertDescription>
                {t.dashboard.toolsDescription}
              </AlertDescription>
            </Alert>
          ) : !access.session ? (
            <Alert>
              <AlertTitle>{t.dashboard.signInTitle}</AlertTitle>
              <AlertDescription className="flex flex-col gap-3">
                {t.dashboard.signInDescription}
                <Button
                  render={<Link href="/login?callbackURL=/admin" />}
                  nativeButton={false}
                  className="w-fit"
                >
                  {t.dashboard.signInAction}
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <AlertTitle>{t.dashboard.inactiveTitle}</AlertTitle>
              <AlertDescription>
                {t.dashboard.inactiveDescription}
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
            title={t.dashboard.links.gamesTitle}
            description={t.dashboard.links.gamesDescription}
          />
          <ManageLink
            href="/admin/media"
            icon={Tv2Icon}
            title={t.dashboard.links.mediaTitle}
            description={t.dashboard.links.mediaDescription}
          />
          <ManageLink
            href="/admin/comments"
            icon={MessagesSquareIcon}
            title={t.dashboard.links.commentsTitle}
            description={t.dashboard.links.commentsDescription}
          />
          {access.isSuper ? (
            <ManageLink
              href="/admin/team"
              icon={UsersIcon}
              title={t.dashboard.links.teamTitle}
              description={t.dashboard.links.teamDescription}
            />
          ) : null}
          {access.isSuper ? (
            <ManageLink
              href="/admin/audit"
              icon={ClipboardListIcon}
              title={t.dashboard.links.auditTitle}
              description={t.dashboard.links.auditDescription}
            />
          ) : null}
        </section>
      ) : null}

      {access.allowed ? (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="text-xl font-semibold">{t.dashboard.newsTitle}</h2>
            <p className="text-sm text-muted-foreground">
              {t.dashboard.newsDescription}
            </p>
          </div>
          <NewsList posts={posts} games={games} locale={locale} />
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
