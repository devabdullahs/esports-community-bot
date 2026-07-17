"use client";

import {
  BellIcon,
  LayoutDashboardIcon,
  SettingsIcon,
  StarIcon,
  TargetIcon,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ProfileDashboard } from "@/components/dashboard/profile-dashboard";
import { MatchCalendarPanel } from "@/components/dashboard/match-calendar-panel";
import { TodayForYou } from "@/components/dashboard/today-for-you";
import { FollowCenter } from "@/components/follows/follow-center";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { copy, type Locale } from "@/lib/i18n";
import {
  normalizeProfileTab,
  profileTabHref,
  type ProfileTab,
} from "@/lib/profile-workspace";

const TABS = [
  { value: "overview", icon: LayoutDashboardIcon },
  { value: "predictions", icon: TargetIcon },
  { value: "following", icon: StarIcon },
  { value: "notifications", icon: BellIcon },
  { value: "settings", icon: SettingsIcon },
] as const;

export function AccountWorkspace({
  guildId,
  season,
  locale,
  initialTab,
}: {
  guildId?: string;
  season: string;
  locale: Locale;
  initialTab: ProfileTab;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const text = copy[locale].profile;

  function onTabChange(value: unknown) {
    const next = normalizeProfileTab(typeof value === "string" ? value : null);
    router.push(profileTabHref(pathname, searchParams.toString(), next), { scroll: false });
  }

  return (
    <Tabs defaultValue={initialTab} onValueChange={onTabChange}>
      <div className="max-w-full overflow-x-auto pb-1">
        <TabsList variant="line" className="min-w-max justify-start">
          {TABS.map(({ value, icon: Icon }) => (
            <TabsTrigger key={value} value={value} className="shrink-0 px-3">
              <Icon data-icon="inline-start" />
              {text.workspaceTabs[value]}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <TabsContent value="overview">
        <div className="flex flex-col gap-8">
          <ProfileDashboard guildId={guildId} season={season} locale={locale} section="overview" />
          <TodayForYou locale={locale} />
          <MatchCalendarPanel locale={locale} />
        </div>
      </TabsContent>
      <TabsContent value="predictions">
        <ProfileDashboard guildId={guildId} season={season} locale={locale} section="predictions" />
      </TabsContent>
      <TabsContent value="following">
        <FollowCenter locale={locale} section="following" />
      </TabsContent>
      <TabsContent value="notifications">
        <FollowCenter locale={locale} section="notifications" />
      </TabsContent>
      <TabsContent value="settings">
        <FollowCenter locale={locale} section="settings" />
      </TabsContent>
    </Tabs>
  );
}
