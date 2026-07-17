import type { Metadata } from "next";
import { CalendarDaysIcon, ShieldCheckIcon, TrophyIcon } from "lucide-react";
import { DateTime } from "@/components/date-time";
import { MvpVote } from "@/components/mvp/mvp-vote";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getCommunityMember } from "@/lib/community";
import { localizedPath } from "@/lib/i18n";
import { buildPageMetadata } from "@/lib/metadata";
import { getMvpVoteView } from "@/lib/mvp";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pageCopy = {
  en: {
    eyebrow: "Community vote",
    title: "MVP of the day",
    description: "Pick yesterday’s standout player from completed matches. One verified member gets one changeable vote.",
    votingFor: "Performances from",
    closes: "Voting closes",
    fair: "Fair community voting",
    fairHint: "Live totals stay hidden until you vote. This vote is for fun and never affects prediction points.",
    labels: { vote: "Vote", changeVote: "Change vote", selected: "Your vote", votes: "votes", hidden: "Vote totals appear after you vote or when the poll closes.", signIn: "Sign in", signInHint: "Sign in with Discord to vote.", verificationHint: "A verified Esports Community membership is required to vote.", emptyTitle: "No eligible performances", emptyDescription: "No supported completed match details were available for this day.", failed: "The vote could not be saved." },
  },
  ar: {
    eyebrow: "تصويت المجتمع",
    title: "أفضل لاعب في اليوم",
    description: "اختر أبرز لاعب من مباريات الأمس المكتملة. لكل عضو موثّق صوت واحد قابل للتغيير.",
    votingFor: "أداء يوم",
    closes: "ينتهي التصويت",
    fair: "تصويت مجتمعي عادل",
    fairHint: "تبقى النتائج مخفية حتى تصوّت. هذا التصويت ترفيهي ولا يؤثر على نقاط التوقعات.",
    labels: { vote: "تصويت", changeVote: "تغيير الصوت", selected: "اختيارك", votes: "أصوات", hidden: "تظهر النتائج بعد تصويتك أو عند إغلاق التصويت.", signIn: "تسجيل الدخول", signInHint: "سجّل الدخول عبر ديسكورد للتصويت.", verificationHint: "يلزم توثيق عضويتك في مجتمع الرياضات الإلكترونية للتصويت.", emptyTitle: "لا توجد ترشيحات مؤهلة", emptyDescription: "لا توجد تفاصيل مباريات مكتملة ومدعومة لهذا اليوم.", failed: "تعذّر حفظ التصويت." },
  },
} as const;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const text = pageCopy[locale];
  return buildPageMetadata({ title: text.title, description: text.description, path: localizedPath("/mvp", locale), locale });
}

export default async function MvpPage() {
  const locale = await getRequestLocale();
  const text = pageCopy[locale];
  const { session, member } = await getCommunityMember();
  const canVote = Boolean(member?.isVerified);
  const vote = await getMvpVoteView(canVote ? member!.discordUserId : null);

  return (
    <main className="flex-1 px-4 py-8 sm:px-8 lg:py-12">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b pb-6">
          <Badge variant="outline" className="w-fit"><TrophyIcon data-icon="inline-start" />{text.eyebrow}</Badge>
          <div className="flex max-w-3xl flex-col gap-2">
            <h1 className="text-3xl font-semibold sm:text-4xl">{text.title}</h1>
            <p className="text-base leading-7 text-muted-foreground">{text.description}</p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary"><CalendarDaysIcon data-icon="inline-start" />{text.votingFor} {vote.voteDate}</Badge>
            {!vote.closed ? <Badge variant="secondary">{text.closes} <DateTime value={vote.closesAt} locale={locale} /></Badge> : null}
          </div>
        </header>
        <Card className="border-border/70 bg-muted/20">
          <CardContent className="flex items-start gap-3 py-4">
            <ShieldCheckIcon className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="flex flex-col gap-1"><p className="font-medium">{text.fair}</p><p className="text-sm text-muted-foreground">{text.fairHint}</p></div>
          </CardContent>
        </Card>
        <MvpVote initialVote={vote} locale={locale} canVote={canVote} signedIn={Boolean(session)} labels={text.labels} />
      </div>
    </main>
  );
}

