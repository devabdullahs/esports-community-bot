export const LOCALES = ["en", "ar"] as const;

export type Locale = (typeof LOCALES)[number];

type LangSearchParams = { lang?: string | string[] | null };
type GetSearchParams = { get(name: string): string | null };

function hasSearchParamGetter(
  searchParams: LangSearchParams | GetSearchParams,
): searchParams is GetSearchParams {
  return typeof (searchParams as GetSearchParams).get === "function";
}

export function localeFromSearchParams(
  searchParams?:
    | LangSearchParams
    | GetSearchParams
    | null,
): Locale {
  if (!searchParams) return "en";
  let value: string | null | undefined;
  if (hasSearchParamGetter(searchParams)) {
    value = searchParams.get("lang");
  } else {
    value = Array.isArray(searchParams.lang)
      ? searchParams.lang[0]
      : searchParams.lang;
  }
  return value === "ar" ? "ar" : "en";
}

export function directionForLocale(locale: Locale) {
  return locale === "ar" ? "rtl" : "ltr";
}

export function numberLocale(locale: Locale) {
  return locale === "ar" ? "ar-SA" : "en-US";
}

export function formatNumber(value: number, locale: Locale) {
  return new Intl.NumberFormat(numberLocale(locale)).format(value);
}

export function formatDateTime(value: string, locale: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(numberLocale(locale), {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function localizedPath(pathname: string, locale: Locale) {
  if (locale === "en") return pathname;
  const separator = pathname.includes("?") ? "&" : "?";
  return `${pathname}${separator}lang=${locale}`;
}

export function localizedHref(
  pathname: string,
  searchParams: { toString(): string } | null | undefined,
  locale: Locale,
) {
  const params = new URLSearchParams(searchParams?.toString());
  if (locale === "en") {
    params.delete("lang");
  } else {
    params.set("lang", locale);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export const copy = {
  en: {
    common: {
      brand: "EWC Predictions",
      community: "Esports Community",
      myProfile: "My profile",
      publicLeaderboard: "Public leaderboard",
      languageSwitch: "العربية",
      themeToggle: "Toggle theme",
      season: "Season",
      points: "Points",
      rank: "Rank",
      weeks: "Weeks",
      wins: "Wins",
      sweeps: "Sweeps",
      topTeams: "Top teams",
      member: "Member",
      previous: "Previous",
      next: "Next",
      notAvailable: "Not available",
    },
    home: {
      eyebrow: "Esports World Cup 2026",
      title: "Community EWC predictions, live leaderboard, and Discord profile showcase.",
      description:
        "A public board for the community and a private profile for syncing your best EWC prediction stats to Discord.",
      openProfile: "Open my profile",
      openLeaderboard: "Open leaderboard",
      profileTitle: "Profile showcase",
      profileDescription: "Rank, points, picks, sync status, and Discord connection controls.",
      leaderboardTitle: "Public leaderboard",
      leaderboardDescription: "Share a public ranking link for any server and season.",
      discordTitle: "Discord-ready",
      discordDescription: "The bot can link, sync, and unlink profile showcase data.",
      routeHint: "Public route",
      noDefaultLeaderboard: "Open a leaderboard link from Discord or use the public URL format.",
      previewTitle: "Current showcase",
      previewName: "#2 overall | 1,240 pts",
      previewTeams: "Falcons, T1, Vitality",
    },
    leaderboard: {
      back: "Back home",
      badge: "Public board",
      title: (season: string) => `EWC ${season} prediction leaderboard`,
      description: (total: number, guildId: string) =>
        `${formatNumber(total, "en")} ranked member${total === 1 ? "" : "s"} for server ${guildId}`,
      rankedMembers: "Ranked members",
      topScore: "Top score",
      searchPlaceholder: "Search members or teams",
      empty: "No ranked predictions yet.",
      page: (page: number, pages: number) => `Page ${formatNumber(page, "en")} of ${formatNumber(pages, "en")}`,
    },
    profile: {
      eyebrow: "EWC dashboard",
      title: "My prediction profile",
      discordPending: "Discord account pending",
      leaderboard: "Leaderboard",
      sync: "Sync profile",
      unlink: "Unlink",
      unavailableTitle: "Profile unavailable",
      noProfileTitle: "No active prediction profile",
      noProfileDescription: "Open this page from /ewc_predict link in Discord to select a server.",
      lastSyncFailed: "Last sync failed",
      syncFailed: "Sync failed",
      unlinkFailed: "Unlink failed",
      unranked: "Unranked",
      points: "Points",
      weeksScored: "Weeks scored",
      weeklyWins: "Weekly wins",
      showcase: "Showcase",
      seasonPicks: "Season picks",
      weeklyHistory: "Weekly history",
      synced: "Synced",
      top3Sweep: (count: number) => `${formatNumber(count, "en")} top 3 sweep${count === 1 ? "" : "s"}`,
      notScored: "Not scored yet",
      noSeasonPicks: "No season picks yet.",
      recentWeekly: "Recent weekly rounds",
      scoredWeeks: (count: number) => `${formatNumber(count, "en")} scored week${count === 1 ? "" : "s"}`,
      noWeeklyPicks: "No weekly picks yet.",
      noPicks: "No picks",
      sweepBonus: "Top 3 sweep bonus",
    },
    login: {
      title: "Discord sign in",
      description: "Connect your Discord account to manage your EWC profile showcase.",
      failedTitle: "Sign in failed",
      failedMessage: "Discord sign-in failed.",
      continue: "Continue with Discord",
    },
    footer: {
      brand: "EWC Predictions - Esports Community Bot",
      note: "Predictions are community fun, not affiliated with the Esports World Cup.",
    },
  },
  ar: {
    common: {
      brand: "توقعات كأس العالم للرياضات الإلكترونية",
      community: "مجتمع الرياضات الإلكترونية",
      myProfile: "ملفي",
      publicLeaderboard: "لوحة الصدارة",
      languageSwitch: "English",
      themeToggle: "تبديل المظهر",
      season: "الموسم",
      points: "النقاط",
      rank: "الترتيب",
      weeks: "الأسابيع",
      wins: "الفوز",
      sweeps: "توقعات كاملة",
      topTeams: "أفضل الفرق",
      member: "العضو",
      previous: "السابق",
      next: "التالي",
      notAvailable: "غير متاح",
    },
    home: {
      eyebrow: "كأس العالم للرياضات الإلكترونية 2026",
      title: "توقعات المجتمع، لوحة صدارة عامة، واستعراض لملفك في ديسكورد.",
      description:
        "لوحة عامة للمجتمع وصفحة خاصة لمزامنة أفضل إحصائيات توقعاتك مع ملفك في ديسكورد.",
      openProfile: "افتح ملفي",
      openLeaderboard: "افتح لوحة الصدارة",
      profileTitle: "استعراض الملف",
      profileDescription: "ترتيبك، نقاطك، اختياراتك، حالة المزامنة، وربط ديسكورد.",
      leaderboardTitle: "لوحة صدارة عامة",
      leaderboardDescription: "شارك رابط ترتيب عام لأي سيرفر وموسم.",
      discordTitle: "جاهز لديسكورد",
      discordDescription: "البوت يدعم الربط والمزامنة وفصل بيانات الاستعراض.",
      routeHint: "الرابط العام",
      noDefaultLeaderboard: "افتح رابط لوحة الصدارة من ديسكورد أو استخدم صيغة الرابط العامة.",
      previewTitle: "استعراض حالي",
      previewName: "#2 إجماليا | 1,240 نقطة",
      previewTeams: "Falcons، T1، Vitality",
    },
    leaderboard: {
      back: "العودة للرئيسية",
      badge: "لوحة عامة",
      title: (season: string) => `لوحة توقعات EWC ${season}`,
      description: (total: number, guildId: string) =>
        `${formatNumber(total, "ar")} عضو في الترتيب لسيرفر ${guildId}`,
      rankedMembers: "الأعضاء المصنفون",
      topScore: "أعلى نقاط",
      searchPlaceholder: "ابحث عن عضو أو فريق",
      empty: "لا توجد توقعات مصنفة حتى الآن.",
      page: (page: number, pages: number) => `صفحة ${formatNumber(page, "ar")} من ${formatNumber(pages, "ar")}`,
    },
    profile: {
      eyebrow: "لوحة EWC",
      title: "ملف توقعاتي",
      discordPending: "حساب ديسكورد غير مربوط",
      leaderboard: "لوحة الصدارة",
      sync: "مزامنة الملف",
      unlink: "فصل الربط",
      unavailableTitle: "الملف غير متاح",
      noProfileTitle: "لا يوجد ملف توقعات نشط",
      noProfileDescription: "افتح هذه الصفحة من أمر /ewc_predict link في ديسكورد لاختيار السيرفر.",
      lastSyncFailed: "فشلت آخر مزامنة",
      syncFailed: "فشلت المزامنة",
      unlinkFailed: "فشل فصل الربط",
      unranked: "غير مصنف",
      points: "النقاط",
      weeksScored: "أسابيع محسوبة",
      weeklyWins: "انتصارات أسبوعية",
      showcase: "الاستعراض",
      seasonPicks: "اختيارات الموسم",
      weeklyHistory: "السجل الأسبوعي",
      synced: "تمت المزامنة",
      top3Sweep: (count: number) => `${formatNumber(count, "ar")} توقع كامل للمراكز الثلاثة`,
      notScored: "لم يتم احتسابه بعد",
      noSeasonPicks: "لا توجد اختيارات للموسم حتى الآن.",
      recentWeekly: "آخر الجولات الأسبوعية",
      scoredWeeks: (count: number) => `${formatNumber(count, "ar")} أسابيع محسوبة`,
      noWeeklyPicks: "لا توجد اختيارات أسبوعية حتى الآن.",
      noPicks: "لا توجد اختيارات",
      sweepBonus: "مكافأة توقع أول ثلاثة",
    },
    login: {
      title: "تسجيل الدخول بديسكورد",
      description: "اربط حسابك في ديسكورد لإدارة استعراض ملف توقعات EWC.",
      failedTitle: "فشل تسجيل الدخول",
      failedMessage: "فشل تسجيل الدخول عبر ديسكورد.",
      continue: "المتابعة عبر ديسكورد",
    },
    footer: {
      brand: "توقعات EWC - بوت مجتمع الرياضات الإلكترونية",
      note: "التوقعات نشاط مجتمعي وليست تابعة لكأس العالم للرياضات الإلكترونية.",
    },
  },
} as const;
