import {
  ArrowRightIcon,
  ClipboardListIcon,
  FileTextIcon,
  Gamepad2Icon,
  type LucideIcon,
  MessagesSquareIcon,
  NewspaperIcon,
  PenLineIcon,
  RadioIcon,
  ShieldIcon,
  SparklesIcon,
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
import { Badge } from "@/components/ui/badge";
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
  const publishedPosts = posts.filter((post) => post.status === "published").length;
  const draftPosts = posts.length - publishedPosts;
  const managedGames = access.allowed
    ? access.games === "ALL"
      ? games.length
      : access.games.length
    : 0;
  const roleLabel = access.isSuper
    ? t.common.superAdmin
    : access.allowed
      ? t.dashboard.roleScoped
      : t.dashboard.eyebrow;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-5 py-8 sm:px-8 lg:py-10">
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="overflow-hidden border-border/70 bg-card/70 shadow-sm">
          <CardHeader className="gap-7 border-b border-border/60 bg-muted/10 p-6 sm:p-7">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="w-fit">
                <SparklesIcon data-icon="inline-start" />
                {roleLabel}
              </Badge>
              {access.displayName ? (
                <span className="text-sm text-muted-foreground">
                  {access.displayName}
                </span>
              ) : null}
            </div>
            <div className="max-w-3xl">
              <CardTitle className="text-balance text-3xl leading-tight sm:text-4xl">
                {t.dashboard.title}
              </CardTitle>
              <CardDescription className="mt-3 text-sm leading-6 sm:text-base sm:leading-7">
                {t.dashboard.description}
              </CardDescription>
            </div>
            {access.allowed ? (
              <div className="flex flex-wrap gap-2">
                <Button render={<Link href="/admin/news/new" />} nativeButton={false}>
                  <PenLineIcon data-icon="inline-start" />
                  {t.dashboard.quickNewPost}
                </Button>
                <Button
                  render={<Link href="/admin/comments" />}
                  nativeButton={false}
                  variant="outline"
                >
                  <MessagesSquareIcon data-icon="inline-start" />
                  {t.dashboard.quickComments}
                </Button>
                <Button
                  render={<Link href="/admin/games" />}
                  nativeButton={false}
                  variant="outline"
                >
                  <Gamepad2Icon data-icon="inline-start" />
                  {t.dashboard.quickGames}
                </Button>
              </div>
            ) : null}
          </CardHeader>
        </Card>

        <Card className="border-border/70 bg-card/70 shadow-sm">
          <CardHeader className="p-6 sm:p-7">
            <div className="flex items-start gap-3">
              <span className="rounded-lg border border-primary/30 bg-primary/10 p-2 text-primary">
                <ShieldIcon data-icon="inline-start" />
              </span>
              <div className="min-w-0">
                <CardTitle>{t.dashboard.accessTitle}</CardTitle>
                <CardDescription className="mt-2 leading-6">
                  {t.dashboard.accessDescription}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-6 pb-6 sm:px-7 sm:pb-7">
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
      </section>

      {access.allowed ? (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={NewspaperIcon}
            label={t.dashboard.stats.posts}
            value={posts.length}
            description={t.dashboard.stats.postsDescription}
          />
          <StatCard
            icon={FileTextIcon}
            label={t.dashboard.stats.published}
            value={publishedPosts}
            description={t.dashboard.stats.publishedDescription}
          />
          <StatCard
            icon={PenLineIcon}
            label={t.dashboard.stats.drafts}
            value={draftPosts}
            description={t.dashboard.stats.draftsDescription}
          />
          <StatCard
            icon={Gamepad2Icon}
            label={t.dashboard.stats.games}
            value={managedGames}
            description={t.dashboard.stats.gamesDescription}
          />
        </section>
      ) : null}

      {access.allowed ? (
        <section className="flex flex-col gap-4 rounded-xl border border-border/70 bg-card/40 p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold">{t.dashboard.workspaceTitle}</h2>
            <p className="text-sm text-muted-foreground">
              {t.dashboard.workspaceDescription}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                href="/admin/users"
                icon={UsersIcon}
                title={t.dashboard.links.usersTitle}
                description={t.dashboard.links.usersDescription}
              />
            ) : null}
            {access.isSuper ? (
              <ManageLink
                href="/admin/streams"
                icon={RadioIcon}
                title={t.dashboard.links.streamsTitle}
                description={t.dashboard.links.streamsDescription}
              />
            ) : null}
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
          </div>
        </section>
      ) : null}

      {access.allowed ? (
        <section className="flex flex-col gap-4 rounded-xl border border-border/70 bg-card/40 p-5 shadow-sm sm:p-6">
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

function StatCard({
  icon: Icon,
  label,
  value,
  description,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  description: string;
}) {
  return (
    <Card className="border-border/70 bg-card/70 shadow-sm transition-colors hover:bg-card">
      <CardHeader className="gap-3 p-5">
        <div className="flex items-center justify-between gap-3">
          <CardDescription className="font-medium">{label}</CardDescription>
          <span className="rounded-lg border border-primary/20 bg-primary/10 p-2 text-primary">
            <Icon data-icon="inline-start" />
          </span>
        </div>
        <CardTitle className="text-3xl leading-none">{value}</CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5 pt-0">
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
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
      className="group rounded-xl border border-border/70 bg-card/70 p-4 shadow-sm transition-colors hover:bg-card"
    >
      <span className="flex items-start gap-3">
        <span className="rounded-lg border border-primary/20 bg-primary/10 p-2 text-primary">
          <Icon data-icon="inline-start" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 font-semibold">
            {title}
            <ArrowRightIcon className="ms-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
          </span>
          <span className="mt-1 block text-sm leading-6 text-muted-foreground">
            {description}
          </span>
        </span>
      </span>
    </Link>
  );
}
