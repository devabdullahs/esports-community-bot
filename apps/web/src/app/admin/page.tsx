import {
  ActivityIcon,
  ArrowRightIcon,
  BarChart3Icon,
  CheckCircle2Icon,
  ClipboardListIcon,
  FileTextIcon,
  Gamepad2Icon,
  HandshakeIcon,
  ListChecksIcon,
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
import { Separator } from "@/components/ui/separator";

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
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 overflow-hidden px-4 py-6 sm:px-6 lg:gap-10 lg:px-8 lg:py-10">
      <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="overflow-hidden border-border/70 bg-card/70 shadow-sm">
          <CardHeader className="gap-6 border-b border-border/60 bg-muted/10 p-5 sm:gap-7 sm:p-7">
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
              <CardTitle className="text-balance text-2xl leading-tight sm:text-4xl">
                {t.dashboard.title}
              </CardTitle>
              <CardDescription className="mt-3 text-sm leading-6 sm:text-base sm:leading-7">
                {t.dashboard.description}
              </CardDescription>
            </div>
            {access.allowed ? (
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
                <Button
                  render={<Link href="/admin/news/new" />}
                  nativeButton={false}
                  className="w-full sm:w-auto"
                >
                  <PenLineIcon data-icon="inline-start" />
                  {t.dashboard.quickNewPost}
                </Button>
                <Button
                  render={<Link href="/admin/comments" />}
                  nativeButton={false}
                  variant="outline"
                  className="w-full sm:w-auto"
                >
                  <MessagesSquareIcon data-icon="inline-start" />
                  {t.dashboard.quickComments}
                </Button>
                <Button
                  render={<Link href="/admin/games" />}
                  nativeButton={false}
                  variant="outline"
                  className="w-full sm:w-auto"
                >
                  <Gamepad2Icon data-icon="inline-start" />
                  {t.dashboard.quickGames}
                </Button>
                {access.isSuper ? (
                  <Button
                    render={<Link href="/admin/analytics" />}
                    nativeButton={false}
                    variant="outline"
                    className="w-full sm:w-auto"
                  >
                    <BarChart3Icon data-icon="inline-start" />
                    {t.dashboard.quickAnalytics}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </CardHeader>
        </Card>

        <Card className="min-w-0 border-border/70 bg-card/70 shadow-sm">
          <CardHeader className="p-5 sm:p-7">
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
          <CardContent className="px-5 pb-5 sm:px-7 sm:pb-7">
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
                    className="w-full sm:w-fit"
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
        <section className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Card className="min-w-0 border-border/70 bg-card/70 shadow-sm">
            <CardHeader className="gap-3 p-4 sm:p-6">
              <Badge variant="secondary" className="w-fit">
                <ListChecksIcon data-icon="inline-start" />
                {t.dashboard.workflowEyebrow}
              </Badge>
              <div>
                <CardTitle>{t.dashboard.workflowTitle}</CardTitle>
                <CardDescription className="mt-2 leading-6">
                  {t.dashboard.workflowDescription}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 px-4 pb-4 pt-0 sm:px-6 sm:pb-6">
              {t.dashboard.workflowItems.map((item, index) => (
                <WorkflowStep
                  key={item.title}
                  index={index + 1}
                  title={item.title}
                  description={item.description}
                />
              ))}
            </CardContent>
          </Card>

          <Card className="min-w-0 border-border/70 bg-card/70 shadow-sm">
            <CardHeader className="gap-3 p-4 sm:p-6">
              <div className="flex items-start gap-3">
                <span className="rounded-lg border border-primary/20 bg-primary/10 p-2 text-primary">
                  <ActivityIcon data-icon="inline-start" />
                </span>
                <div className="min-w-0">
                  <CardTitle>{t.dashboard.scopeTitle}</CardTitle>
                  <CardDescription className="mt-2 leading-6">
                    {t.dashboard.scopeDescription}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 px-4 pb-4 pt-0 sm:px-6 sm:pb-6">
              <ScopeMetric label={t.dashboard.scope.posts} value={posts.length} />
              <Separator />
              <ScopeMetric label={t.dashboard.scope.drafts} value={draftPosts} />
              <Separator />
              <ScopeMetric label={t.dashboard.scope.games} value={managedGames} />
            </CardContent>
          </Card>
        </section>
      ) : null}

      {access.allowed ? (
        <section className="flex min-w-0 flex-col gap-4 rounded-xl border border-border/70 bg-card/40 p-4 shadow-sm sm:p-6">
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
                href="/admin/analytics"
                icon={BarChart3Icon}
                title={t.dashboard.links.analyticsTitle}
                description={t.dashboard.links.analyticsDescription}
              />
            ) : null}
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
                href="/admin/partners"
                icon={HandshakeIcon}
                title={t.dashboard.links.partnersTitle}
                description={t.dashboard.links.partnersDescription}
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
        <section className="flex min-w-0 flex-col gap-4 overflow-hidden rounded-xl border border-border/70 bg-card/40 p-4 shadow-sm sm:p-6">
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

function WorkflowStep({
  index,
  title,
  description,
}: {
  index: number;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-border/70 bg-muted/20 p-3 sm:p-4">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-sm font-semibold text-primary">
        {index}
      </span>
      <span className="min-w-0">
        <span className="flex items-start gap-2 font-semibold">
          <CheckCircle2Icon
            data-icon="inline-start"
            className="size-4 text-primary"
          />
          {title}
        </span>
        <span className="mt-1 block text-sm leading-6 text-muted-foreground">
          {description}
        </span>
      </span>
    </div>
  );
}

function ScopeMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="rounded-md border border-border bg-muted px-2 py-1 font-semibold text-foreground">
        {value}
      </span>
    </div>
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
      <CardHeader className="gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardDescription className="font-medium">{label}</CardDescription>
          <span className="rounded-lg border border-primary/20 bg-primary/10 p-2 text-primary">
            <Icon data-icon="inline-start" />
          </span>
        </div>
        <CardTitle className="text-2xl leading-none sm:text-3xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 sm:px-5 sm:pb-5">
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
      className="group min-w-0 rounded-xl border border-border/70 bg-card/70 p-3 shadow-sm transition-colors hover:bg-card sm:p-4"
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
