import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, TargetIcon, TrophyIcon, UserRoundIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { localizedPath } from "@/lib/i18n";
import { buildPageMetadata } from "@/lib/metadata";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: "EWC prediction leaderboards",
    description:
      "Join weekly and season Esports World Cup predictions in Discord, then track ranks, points, and profiles on the community leaderboard.",
    path: "/predictions",
  });
}

const COPY = {
  en: {
    eyebrow: "Predictions",
    title: "EWC prediction boards",
    description:
      "Make weekly and season predictions in Discord, then track your rank, points, and top teams here.",
    profileTitle: "Your prediction profile",
    profileDescription: "See your rank, points, weekly history, and sync your Discord showcase.",
    openProfile: "Open my profile",
    leaderboardTitle: "Public leaderboard",
    leaderboardDescription: "Browse a server's full ranking for the season.",
    openLeaderboard: "Open leaderboard",
  },
  ar: {
    eyebrow: "التوقعات",
    title: "لوحات توقعات كأس العالم للرياضات الإلكترونية",
    description:
      "قدّم توقعاتك الأسبوعية والموسمية عبر ديسكورد، ثم تابع ترتيبك ونقاطك وأفضل فرقك هنا.",
    profileTitle: "ملف توقعاتك",
    profileDescription: "اطّلع على ترتيبك ونقاطك وسجلك الأسبوعي، وزامن عرضك على ديسكورد.",
    openProfile: "افتح ملفي",
    leaderboardTitle: "لوحة الصدارة العامة",
    leaderboardDescription: "تصفّح ترتيب الخادم الكامل للموسم.",
    openLeaderboard: "افتح لوحة الصدارة",
  },
} as const;

export default async function PredictionsPage() {
  const locale = await getRequestLocale();
  const t = COPY[locale];
  // The /leaderboard index auto-resolves the guild (DB-derived) and redirects,
  // so we always link to it and never need a Discord-command fallback hint.
  const leaderboardHref = localizedPath("/leaderboard", locale);

  return (
    <main
      className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-5 py-10 sm:px-8"
    >
      <section className="flex max-w-3xl flex-col items-start gap-4">
        <Badge variant="outline">
          <TargetIcon data-icon="inline-start" />
          {t.eyebrow}
        </Badge>
        <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">{t.title}</h1>
        <p className="text-sm leading-6 text-muted-foreground sm:text-base">{t.description}</p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card size="sm" className="h-full">
          <CardHeader>
            <div className="mb-2 flex size-9 items-center justify-center rounded-md border bg-muted">
              <UserRoundIcon />
            </div>
            <CardTitle>{t.profileTitle}</CardTitle>
            <CardDescription>{t.profileDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href={localizedPath("/me", locale)} />} nativeButton={false} variant="outline" size="sm">
              {t.openProfile}
              <ArrowRightIcon data-icon="inline-end" className="rtl:rotate-180" />
            </Button>
          </CardContent>
        </Card>

        <Card size="sm" className="h-full">
          <CardHeader>
            <div className="mb-2 flex size-9 items-center justify-center rounded-md border bg-muted">
              <TrophyIcon />
            </div>
            <CardTitle>{t.leaderboardTitle}</CardTitle>
            <CardDescription>{t.leaderboardDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href={leaderboardHref} />} nativeButton={false} variant="outline" size="sm">
              {t.openLeaderboard}
              <ArrowRightIcon data-icon="inline-end" className="rtl:rotate-180" />
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
