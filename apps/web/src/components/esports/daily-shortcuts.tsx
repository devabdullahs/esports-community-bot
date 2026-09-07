import { NavigationLink as Link } from "@/components/navigation-link";
import { ArrowUpRightIcon, BellRingIcon, TargetIcon, TrophyIcon } from "lucide-react";
import { localizedPath, type Locale } from "@/lib/i18n";

export function DailyShortcuts({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  const items = [
    { href: "/me", icon: BellRingIcon, title: ar ? "يومك في المنافسة" : "Your daily feed", description: ar ? "تابع ألعابك وفرقك واجمع تحديثاتها في مكان واحد." : "Follow your games and teams. Catch up in one place." },
    { href: "/predictions", icon: TargetIcon, title: ar ? "التوقعات والنتائج" : "Picks & results", description: ar ? "تفقّد الجولات المتاحة ونتائج توقعات المجتمع." : "Check available rounds and the community’s picks." },
    { href: "/clubs/standings", icon: TrophyIcon, title: ar ? "ترتيب أندية كأس العالم" : "EWC club standings", description: ar ? "تابع نقاط الأندية ونتائج البطولات." : "Keep up with club points and tournament results." },
  ];
  return (
    <nav className="ec-daily-shortcuts" aria-label={ar ? "تابع المنافسة بطريقتك" : "Make it your esports day"}>
      {items.map(({ href, icon: Icon, title, description }) => (
        <Link key={href} href={localizedPath(href, locale)}>
          <Icon className="size-5 text-primary" aria-hidden="true" />
          <span><strong>{title}</strong><span>{description}</span></span>
          <ArrowUpRightIcon className="size-4 text-muted-foreground rtl:-rotate-90" aria-hidden="true" />
        </Link>
      ))}
    </nav>
  );
}
