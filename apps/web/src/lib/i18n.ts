export const LOCALES = ["en", "ar"] as const;
export const LOCALE_COOKIE_NAME = "ewc_locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type Locale = (typeof LOCALES)[number];

type LangSearchParams = { lang?: string | string[] | null };
type GetSearchParams = { get(name: string): string | null };

function hasSearchParamGetter(searchParams: LangSearchParams | GetSearchParams): searchParams is GetSearchParams {
  return typeof (searchParams as GetSearchParams).get === "function";
}

export function localeFromString(value?: string | null): Locale | null {
  return value === "ar" || value === "en" ? value : null;
}

export function localeFromAcceptLanguage(value?: string | null): Locale {
  if (!value) return "en";
  const languages = value
    .split(",")
    .map((item) => item.trim().split(";")[0]?.toLowerCase())
    .filter(Boolean);
  return languages.some((language) => language === "ar" || language.startsWith("ar-")) ? "ar" : "en";
}

export function localeFromSearchParams(searchParams?: LangSearchParams | GetSearchParams | null): Locale {
  if (!searchParams) return "en";
  const value = hasSearchParamGetter(searchParams) ? searchParams.get("lang") : Array.isArray(searchParams.lang) ? searchParams.lang[0] : searchParams.lang;
  return localeFromString(value) || "en";
}

export function directionForLocale(locale: Locale) { return locale === "ar" ? "rtl" : "ltr"; }
export function numberLocale(locale: Locale) { return locale === "ar" ? "ar-SA" : "en-US"; }
export function formatNumber(value: number, locale: Locale) { return new Intl.NumberFormat(numberLocale(locale)).format(value); }

export function formatMatchCount(value: number, locale: Locale) {
  const count = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  if (locale === "en") {
    return `${formatNumber(count, locale)} match${count === 1 ? "" : "es"}`;
  }
  if (count === 0) return "\u0644\u0627 \u062a\u0648\u062c\u062f \u0645\u0628\u0627\u0631\u064a\u0627\u062a";
  if (count === 1) return "\u0645\u0628\u0627\u0631\u0627\u0629 \u0648\u0627\u062d\u062f\u0629";
  if (count === 2) return "\u0645\u0628\u0627\u0631\u0627\u062a\u0627\u0646";
  if (count >= 3 && count <= 10) {
    return `${formatNumber(count, locale)} \u0645\u0628\u0627\u0631\u064a\u0627\u062a`;
  }
  return `${formatNumber(count, locale)} \u0645\u0628\u0627\u0631\u0627\u0629`;
}

export function formatMatchStatusCount(value: number, status: "live" | "upcoming", locale: Locale) {
  const count = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  if (locale === "en") {
    const label = status === "live" ? "live" : "upcoming";
    if (count === 0) return `No ${label} matches`;
    return `${formatNumber(count, locale)} ${label} match${count === 1 ? "" : "es"}`;
  }

  if (status === "live") {
    if (count === 0) return "\u0644\u0627 \u062a\u0648\u062c\u062f \u0645\u0628\u0627\u0631\u064a\u0627\u062a \u0645\u0628\u0627\u0634\u0631\u0629";
    if (count === 1) return "\u0645\u0628\u0627\u0631\u0627\u0629 \u0648\u0627\u062d\u062f\u0629 \u0645\u0628\u0627\u0634\u0631\u0629";
    if (count === 2) return "\u0645\u0628\u0627\u0631\u0627\u062a\u0627\u0646 \u0645\u0628\u0627\u0634\u0631\u062a\u0627\u0646";
    if (count >= 3 && count <= 10) {
      return `${formatNumber(count, locale)} \u0645\u0628\u0627\u0631\u064a\u0627\u062a \u0645\u0628\u0627\u0634\u0631\u0629`;
    }
    return `${formatNumber(count, locale)} \u0645\u0628\u0627\u0631\u0627\u0629 \u0645\u0628\u0627\u0634\u0631\u0629`;
  }

  if (count === 0) return "\u0644\u0627 \u062a\u0648\u062c\u062f \u0645\u0628\u0627\u0631\u064a\u0627\u062a \u0642\u0627\u062f\u0645\u0629";
  if (count === 1) return "\u0645\u0628\u0627\u0631\u0627\u0629 \u0648\u0627\u062d\u062f\u0629 \u0642\u0627\u062f\u0645\u0629";
  if (count === 2) return "\u0645\u0628\u0627\u0631\u0627\u062a\u0627\u0646 \u0642\u0627\u062f\u0645\u062a\u0627\u0646";
  if (count >= 3 && count <= 10) {
    return `${formatNumber(count, locale)} \u0645\u0628\u0627\u0631\u064a\u0627\u062a \u0642\u0627\u062f\u0645\u0629`;
  }
  return `${formatNumber(count, locale)} \u0645\u0628\u0627\u0631\u0627\u0629 \u0642\u0627\u062f\u0645\u0629`;
}

export function formatResultCount(value: number, locale: Locale) {
  const count = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  if (locale === "en") {
    if (count === 0) return "No recent results";
    return `${formatNumber(count, locale)} recent result${count === 1 ? "" : "s"}`;
  }

  if (count === 0) return "\u0644\u0627 \u062a\u0648\u062c\u062f \u0646\u062a\u0627\u0626\u062c \u062d\u062f\u064a\u062b\u0629";
  if (count === 1) return "\u0646\u062a\u064a\u062c\u0629 \u0648\u0627\u062d\u062f\u0629 \u062d\u062f\u064a\u062b\u0629";
  if (count === 2) return "\u0646\u062a\u064a\u062c\u062a\u0627\u0646 \u062d\u062f\u064a\u062b\u062a\u0627\u0646";
  if (count >= 3 && count <= 10) {
    return `${formatNumber(count, locale)} \u0646\u062a\u0627\u0626\u062c \u062d\u062f\u064a\u062b\u0629`;
  }
  return `${formatNumber(count, locale)} \u0646\u062a\u064a\u062c\u0629 \u062d\u062f\u064a\u062b\u0629`;
}

export const LOCALE_ROUTE_HEADER = "x-ec-locale";

function splitHref(value: string) {
  const hashIndex = value.indexOf("#");
  const queryIndex = value.indexOf("?");
  const suffixIndex =
    hashIndex === -1 ? queryIndex : queryIndex === -1 ? hashIndex : Math.min(hashIndex, queryIndex);
  if (suffixIndex === -1) return { pathname: value, suffix: "" };
  return { pathname: value.slice(0, suffixIndex), suffix: value.slice(suffixIndex) };
}

export function stripLocalePrefix(pathname: string) {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (path === "/ar") return "/";
  if (path.startsWith("/ar/")) return path.slice(3) || "/";
  return path || "/";
}

export function localeFromPathname(pathname: string): Locale | null {
  return pathname === "/ar" || pathname.startsWith("/ar/") ? "ar" : null;
}

function isPathUnder(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isLocaleRoutedPath(pathname: string) {
  const { pathname: rawPathname } = splitHref(pathname);
  const cleanPath = stripLocalePrefix(rawPathname);
  return !["/admin", "/api", "/login", "/me"].some((prefix) =>
    isPathUnder(cleanPath, prefix),
  );
}

export type DateTimeValue = string | number | Date;

const DATE_WITHOUT_ZONE_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?$/;

export function parseDateTime(value: DateTimeValue) {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  const trimmed = value.trim();
  // Database timestamps are stored as UTC text without a timezone suffix.
  const normalized = DATE_WITHOUT_ZONE_RE.test(trimmed)
    ? `${trimmed.replace(" ", "T")}Z`
    : trimmed;
  return new Date(normalized);
}

export function dateTimeIso(value: DateTimeValue) {
  const date = parseDateTime(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function formatDateTime(value: DateTimeValue, locale: Locale) {
  const date = parseDateTime(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(numberLocale(locale), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

// Match scheduled_at is stored as unix seconds (UTC). Render it with the same
// locale-aware formatter the rest of the dashboard uses.
export function formatUnixSeconds(value: number | null | undefined, locale: Locale) {
  if (value == null || !Number.isFinite(value)) return "";
  return formatDateTime(new Date(value * 1000).toISOString(), locale);
}

export function localizedPath(pathname: string, locale: Locale) {
  const { pathname: rawPathname, suffix } = splitHref(pathname);
  const cleanPath = stripLocalePrefix(rawPathname);
  if (locale === "ar" && isLocaleRoutedPath(cleanPath)) {
    return cleanPath === "/" ? `/ar${suffix}` : `/ar${cleanPath}${suffix}`;
  }
  return `${cleanPath}${suffix}`;
}

export function localizedHref(pathname: string, searchParams: { toString(): string } | null | undefined, locale: Locale) {
  const { pathname: rawPathname, suffix } = splitHref(pathname);
  const params = new URLSearchParams(searchParams?.toString() || suffix.replace(/^\?/, ""));
  params.delete("lang");
  const query = params.toString();
  return localizedPath(query ? `${rawPathname}?${query}` : rawPathname, locale);
}

const baseCopy = {
  en: {
    common: {
      brand: "Esports Community",
      community: "Dashboard",
      home: "Home",
      menu: "Menu",
      games: "Games",
      browse: "Browse",
      account: "Account",
      news: "News",
      media: "Media",
      partners: "Partners",
      tournaments: "Tournaments",
      teams: "Teams",
      discord: "Discord",
      joinDiscord: "Join Discord",
      predictions: "Predictions",
      admin: "Admin",
      myProfile: "My profile",
      signOut: "Sign out",
      publicLeaderboard: "Public leaderboard",
      ewc: "EWC",
      ewcNews: "EWC news",
      ewcTournaments: "EWC tournaments",
      coStreams: "Co-streams",
      languageSwitch: "\u0627\u0644\u0639\u0631\u0628\u064a\u0629",
      themeToggle: "Toggle theme",
      skipToContent: "Skip to main content",
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
      notFoundTitle: "Page not found",
      notFoundBody: "The page you're looking for doesn't exist or has moved.",
      errorTitle: "Something went wrong",
      errorBody: "An unexpected error occurred. Please try again.",
      retry: "Try again",
      loadingLabel: "Loading...",
      termsOfService: "Terms of Service",
      privacyPolicy: "Privacy Policy",
      newer: "Newer",
      older: "Older",
    },
    home: {
      eyebrow: "Community hub",
      title: "Your esports community, all in one place.",
      description: "Follow the games you love, catch the latest news, and climb your community's prediction leaderboard.",
      openGames: "Browse games",
      openProfile: "My profile",
      openLeaderboard: "Leaderboard",
      gamesHeading: "Games",
      gamesSubtitle: "Jump into the games your community follows.",
      newsHeading: "Latest news",
      newsSubtitle: "Fresh updates from across the community.",
      featuredNews: "Featured",
      readStory: "Read story",
      moreNews: "More updates",
      newsEmpty: "No posts yet - check back soon.",
      seeAll: "View all",
      liveHeading: "Live now",
      liveSubtitle: "Matches being played right now.",
      upcomingHeading: "Upcoming",
      upcomingSubtitle: "Tournaments with matches on the way.",
      liveEmpty: "No live or upcoming matches right now.",
      viewTournament: "View",
      adminTitle: "Admin desk",
      adminDescription: "A private workspace for community content, game pages, news drafts, and bot-facing data.",
      gamePagesTitle: "Game pages",
      gamePagesDescription: "Each game gets a public page for coverage, posts, useful links, and community context.",
      newsTitle: "News and posts",
      newsDescription: "Prepare concise esports updates for the website and Discord audience.",
      predictionsTitle: "Prediction boards",
      predictionsDescription: "Public leaderboards and Discord profile sync stay available as one community module.",
      profileTitle: "Member profiles",
      profileDescription: "Rank, points, top teams, sync status, and the exact text shown on Discord.",
      leaderboardTitle: "Public leaderboard",
      leaderboardDescription: "Share a public ranking page for any server and season without requiring login.",
      discordTitle: "Discord connection",
      discordDescription: "Bot commands can link, sync, and unlink the profile connection from Discord.",
      routeHint: "Public route",
      noDefaultLeaderboard: "Open a leaderboard link from Discord or use the public URL format.",
      previewTitle: "One community hub, several workflows.",
      previewDescription: "Members get a clean public site. Staff get a private path for publishing, game coverage, and future bot data tools.",
      previewName: "#2 overall | 1,240 pts",
      previewTeams: "Falcons, T1, Vitality",
      scoreboardLabel: "Supports",
      scoreboardRows: [
        ["Members", "Browse game pages, news, leaderboards, and profile tools"],
        ["Game admins", "Maintain dedicated pages for schedules, results, and links"],
        ["Social managers", "Draft short posts and preview them before publishing"],
        ["Admins", "Manage community surfaces without exposing staff actions publicly"],
      ],
      featureTitle: "Community first, predictions included.",
      featureDescription: "EWC predictions are one module inside the broader community hub, not the identity of the whole site.",
    },
    games: {
      eyebrow: "Game pages",
      title: "Dedicated pages for every game your community follows.",
      description: "Give game admins and social managers a clean place to organize coverage, post summaries, and share links back to Discord.",
      openGame: "Open game",
      newsLabel: "Community news",
      newsTitle: "Posts that can travel from the site to Discord.",
      newsDescription: "Game pages keep short updates close to the game context, so members can browse by title instead of digging through channels.",
    },
    tournaments: {
      eyebrow: "Tournaments",
      title: "Tracked tournaments",
      description: "Live match data from the community's tracked events.",
      empty: "No tournaments tracked yet.",
      archiveLink: "View finished tournaments",
      archiveTitle: "Finished tournaments",
      archiveDescription: "Browse archived tracked events after every match has finished.",
      archiveEmpty: "No finished tournaments archived yet.",
      activeLink: "Back to tracked tournaments",
      archivedBadge: "Archived",
      noFiltered: "No tournaments match these filters.",
      filters: "Filters",
      searchPlaceholder: "Search tournaments, teams, or games",
      allGames: "All games",
      allStatuses: "All statuses",
      allSources: "All sources",
      clearFilters: "Clear filters",
      showing: "Showing",
      trackedGames: "Tracked games",
      trackedTournaments: "Tracked tournaments",
      liveTournaments: "Live tournaments",
      upcomingTournaments: "Upcoming tournaments",
      resultsTournaments: "Tournaments with results",
      live: "Live",
      upcoming: "Upcoming",
      finished: "Finished",
      source: "Source",
      eventSource: "Event source",
      featuredMatch: "Featured match",
      nextMatch: "Next match",
      latestResult: "Latest result",
      openTournament: "Open tournament",
      viewMatches: "View matches",
      back: "Back to tournaments",
      liveNow: "Live now",
      coStreaming: "Co-streaming",
      watchNow: "Watch now",
      results: "Recent results",
      noLive: "No live matches right now.",
      noUpcoming: "No upcoming matches.",
      noResults: "No results yet.",
      noMatches: "No matches for this tournament yet.",
      time: "Time",
      match: "Match",
      score: "Score",
      result: "Result",
      standings: "Standings",
      participants: "Participants",
      rank: "Rank",
      seed: "Seed",
      team: "Team",
      points: "Points",
      vs: "vs",
      tbd: "TBD",
      timeTbd: "Time TBD",
      today: "Today",
      tomorrow: "Tomorrow",
      winner: "Winner",
      draw: "Draw",
      openSource: "View on source",
      attribution: "Data from Liquipedia — CC-BY-SA 3.0",
      attributionView: "liquipedia.net",
      attributionLicense: "CC-BY-SA 3.0",
    },
    game: {
      back: "Back to games",
      admin: "Admin",
      owner: "Owner",
      postsTitle: "Latest posts",
      postsEmpty: "No posts here yet. Check back soon.",
      readMore: "Read post",
      published: "Published",
    },
    leaderboard: {
      back: "Back home",
      badge: "Public board",
      rankedMembers: "Ranked members",
      topScore: "Top score",
      searchPlaceholder: "Search members or teams",
      empty: "No ranked predictions yet.",
      noBoardTitle: "No leaderboard yet",
      noBoardDescription: "Once the community runs a prediction season, its ranking shows up here automatically.",
    },
    profile: {
      eyebrow: "EWC dashboard",
      title: "My prediction profile",
      discordPending: "Discord account pending",
      leaderboard: "Leaderboard",
      sync: "Refresh",
      unlink: "Unlink",
      unavailableTitle: "Profile unavailable",
      noProfileTitle: "No prediction profile yet",
      noProfileDescription: "To get a profile, make predictions in Discord with /ewc_predict weekly and /ewc_predict season, then link your profile with /ewc_predict link.",
      lastSyncFailed: "Last refresh failed",
      syncFailed: "Refresh failed",
      unlinkFailed: "Unlink failed",
      unranked: "Unranked",
      points: "Points",
      weeksScored: "Weeks scored",
      weeklyWins: "Weekly wins",
      showcase: "Showcase",
      seasonPicks: "Season picks",
      weeklyHistory: "Weekly history",
      synced: "Refreshed",
      notScored: "Not scored yet",
      noSeasonPicks: "No season picks yet.",
      recentWeekly: "Recent weekly rounds",
      noWeeklyPicks: "No weekly picks yet.",
      noPicks: "No picks",
      sweepBonus: "Top 3 sweep bonus",
    },
    follows: {
      follow: "Follow",
      following: "Following",
      unfollow: "Unfollow",
      signInToFollow: "Sign in to follow",
      followingTitle: "Following",
      followingDescription: "Games, tournaments, teams, and players you get match alerts for.",
      noFollows: "You are not following anything yet. Use the Follow button on any game, tournament, team, or player page.",
      notificationsTitle: "Notifications",
      notificationsDescription: "Match alerts for everything you follow.",
      noNotifications: "No notifications yet.",
      unreadCount: (count: number) => `${count} unread`,
      markAllRead: "Mark all read",
      matchStart: "Match started",
      matchResult: "Final result",
      settingsTitle: "Notification settings",
      settingsDescription: "Choose what you get notified about and where.",
      dmEnabled: "Discord DMs",
      dmEnabledHelp: "Also deliver alerts as a Discord direct message.",
      notifyMatchStart: "Match start",
      notifyMatchStartHelp: "When a followed team, player, tournament, or game goes live.",
      notifyMatchResult: "Match results",
      notifyMatchResultHelp: "When a followed match finishes with a final score.",
      entityTypes: {
        game: "Game",
        tournament: "Tournament",
        team: "Team",
        player: "Player",
      },
      loadFailed: "Could not load. Try again.",
      updateFailed: "Could not update. Try again.",
    },
    profiles: {
      teams: "Teams",
      players: "Players",
      teamsDirectoryTitle: "Teams",
      teamsDirectoryDescription: "Browse the teams from the community's tracked games — rosters, regions, and profiles.",
      playersDirectoryTitle: "Players",
      playersDirectoryDescription: "Browse pro players from the community's tracked games.",
      searchPlaceholder: "Search by name",
      searchAction: "Search",
      allGames: "All games",
      noResults: "Nothing matches your search yet. Profiles sync nightly, so new teams and players appear over time.",
      resultsCount: (count: number) => `${count} result${count === 1 ? "" : "s"}`,
      prevPage: "Previous",
      nextPage: "Next",
      pageLabel: (page: number) => `Page ${page}`,
      viewAllTeams: "Browse all teams",
      viewAllPlayers: "Browse all players",
      teamProfile: "Team profile",
      playerProfile: "Player profile",
      roster: "Roster",
      noRoster: "No synced players for this team yet.",
      backToGames: "Back to games",
      backToTeams: "Back to teams",
      backToPlayers: "Back to players",
      pandascoreSource: "Profile data from PandaScore",
      profileSourceMixed: "Profile data from Liquipedia and PandaScore",
      liquipediaInfo: "Player information",
      game: "Game",
      romanizedName: "Romanized name",
      status: "Status",
      nationality: "Nationality",
      location: "Location",
      acronym: "Acronym",
      role: "Role",
      currentTeam: "Current team",
      totalWinnings: "Approx. total winnings",
      achievements: "Achievements",
      history: "History",
      updated: "Updated",
      lastSeen: "Last seen",
      unknownTeam: "Team not synced yet",
      noImage: "No image",
      viewTeam: "View team",
      viewPlayer: "View player",
    },
    login: {
      title: "Discord sign in",
      description: "Connect your Discord account to manage your profile tools.",
      failedTitle: "Sign in failed",
      failedMessage: "Discord sign-in failed.",
      continue: "Continue with Discord",
    },
    adminErrors: {
      "title-required": "Title is required in both English and Arabic",
      "title-too-long": "Title is too long",
      "description-too-long": "Description is too long",
      "status-too-long": "Status badge text is too long",
      "owner-too-long": "Owner field is too long",
      "focus-too-many": "Too many focus tags",
      "focus-item-too-long": "A focus tag is too long",
      "name-required": "Name is required in both English and Arabic",
      "name-too-long": "Name is too long",
      "logo-url-too-long": "Logo URL is too long",
      "logo-url-invalid": "Logo must be a valid http(s) URL",
      "link-url-invalid": "Link must be a valid http(s) URL",
      "news-channel-invalid": "Discord channel ID must be a 17-20 digit snowflake",
    },
    composer: {
      newPost: "New post",
      editPost: "Edit post",
      titleLabel: "Title",
      summaryLabel: "Summary",
      bodyLabel: "Article",
      titlePlaceholder: "Add a title",
      summaryPlaceholder: "Add a short summary",
      bodyPlaceholder: "Start writing",
      editTab: "Edit",
      previewTab: "Preview",
      unsavedChanges: "Unsaved changes",
      saveDraft: "Save draft",
      saveAsDraft: "Save as draft",
      publish: "Publish",
      updatePublished: "Update published",
      unpublish: "Unpublish",
      delete: "Delete",
      game: "Game",
      relatedGame: "Related game",
      relatedGameNone: "No related game",
      contentMode: "Content language mode",
      shared: "Shared",
      separate: "Separate",
      sharedHint: "Shared posts show the same text in both site languages.",
      writingLanguage: "Writing language",
      english: "English",
      arabic: "العربية",
      status: "Status",
      published: "Published",
      draft: "Draft",
      author: "Author",
      authors: "Authors",
      authorsHint: "Pick one or more people to credit. Avatars come from their dashboard login.",
      authorLoading: "Loading authors…",
      authorEmpty: "No eligible authors",
      livePreview: "Live preview",
      previewEmpty: "Start writing to preview the post.",
      untitled: "Untitled post",
      cover: "Cover image",
      coverHint: "Recommended 5:2. Click to upload, paste, or drag an image here.",
      coverEdit: "Edit",
      coverReplace: "Replace",
      coverRemove: "Remove",
      coverPlacement: "Cover placement",
      placementTop: "Top of article",
      placementBottom: "Bottom of article",
      placementCardOnly: "Card only",
      ewcLabel: "EWC-related",
      ewcHint: "Tag this post to also show it in the EWC news section.",
      ewcYes: "EWC",
      ewcNo: "General",
      uploadHint: "Paste or drag an image, or click to upload.",
      dropToUpload: "Drop the image to upload",
      uploading: "Uploading…",
      wordCount: "words",
      cropTitle: "Crop image",
      cropDescription: "Drag the crop box to move it, or drag a handle to resize.",
      cropZoom: "Zoom",
      cropAspect: "Aspect ratio",
      cropFree: "Free",
      cropFreeHint: "Free mode: drag the handles to resize width and height independently.",
      cropCancel: "Cancel",
      cropApply: "Apply crop",
      cropApplying: "Applying…",
      cropBeforeUpload: "Crop this image?",
      cropBeforeUploadBody:
        "Would you like to crop this image before adding it, or upload it as-is?",
      cropBeforeUploadCrop: "Crop image",
      cropBeforeUploadAsIs: "Upload as-is",
      cropSkipNotice: "Animated and AVIF images are uploaded without cropping.",
      confirmCancel: "Cancel",
      discardTitle: "Save in shared mode?",
      discardConfirmAction: "Save and discard",
      deleteTitle: "Delete this post?",
      deleteConfirmAction: "Delete",
      publishRequiredShared: "Headline and body are required before publishing.",
      publishRequiredTranslated:
        "English and Arabic headlines and bodies are required before publishing.",
      sharedDiscardConfirm:
        "You are saving in shared mode. The other-language draft will not be saved and its content will be discarded. Continue?",
      deleteConfirm: "Delete this post? This cannot be undone.",
      couldNotSave: "Could not save",
      uploadFailed: "Upload failed",
      saveFailed: "Save failed",
      deleteFailed: "Delete failed",
    },
    footer: {
      brand: "Esports Community Bot",
      note: "Community coverage, prediction boards, and Discord profile showcase.",
      explore: "Explore",
      about: "About",
      contact: "Contact",
      contactHint: "Questions or partnerships? Reach us any time.",
      emailUs: "Email us",
      madeIn: "Proudly made in Saudi Arabia",
      rights: "All rights reserved.",
    },
  },
  ar: {
    common: {
      brand: "\u0645\u062c\u062a\u0645\u0639 \u0627\u0644\u0631\u064a\u0627\u0636\u0627\u062a \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a\u0629",
      community: "\u0644\u0648\u062d\u0629 \u0627\u0644\u062a\u062d\u0643\u0645",
      home: "\u0627\u0644\u0631\u0626\u064a\u0633\u064a\u0629",
      menu: "\u0627\u0644\u0642\u0627\u0626\u0645\u0629",
      games: "\u0627\u0644\u0623\u0644\u0639\u0627\u0628",
      browse: "\u062a\u0635\u0641\u0651\u062d",
      account: "\u0627\u0644\u062d\u0633\u0627\u0628",
      news: "\u0627\u0644\u0623\u062e\u0628\u0627\u0631",
      media: "\u0627\u0644\u0625\u0639\u0644\u0627\u0645",
      partners: "\u0627\u0644\u0634\u0631\u0643\u0627\u0621",
      tournaments: "\u0627\u0644\u0628\u0637\u0648\u0644\u0627\u062a",
      teams: "\u0627\u0644\u0641\u0631\u0642",
      discord: "\u062f\u064a\u0633\u0643\u0648\u0631\u062f",
      joinDiscord: "\u0627\u0646\u0636\u0645 \u0625\u0644\u0649 \u062f\u064a\u0633\u0643\u0648\u0631\u062f",
      predictions: "\u0627\u0644\u062a\u0648\u0642\u0639\u0627\u062a",
      admin: "\u0627\u0644\u0625\u062f\u0627\u0631\u0629",
      myProfile: "\u0645\u0644\u0641\u064a",
      signOut: "\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062e\u0631\u0648\u062c",
      publicLeaderboard: "\u0644\u0648\u062d\u0629 \u0627\u0644\u0635\u062f\u0627\u0631\u0629 \u0627\u0644\u0639\u0627\u0645\u0629",
      ewc: "EWC",
      ewcNews: "\u0623\u062e\u0628\u0627\u0631 EWC",
      ewcTournaments: "\u0628\u0637\u0648\u0644\u0627\u062a EWC",
      coStreams: "\u0627\u0644\u0628\u062b \u0627\u0644\u0645\u0635\u0627\u062d\u0628",
      languageSwitch: "English",
      themeToggle: "\u062a\u0628\u062f\u064a\u0644 \u0627\u0644\u0645\u0638\u0647\u0631",
      skipToContent: "\u062a\u062e\u0637\u064a \u0625\u0644\u0649 \u0627\u0644\u0645\u062d\u062a\u0648\u0649 \u0627\u0644\u0631\u0626\u064a\u0633\u064a",
      season: "\u0627\u0644\u0645\u0648\u0633\u0645",
      points: "\u0627\u0644\u0646\u0642\u0627\u0637",
      rank: "\u0627\u0644\u062a\u0631\u062a\u064a\u0628",
      weeks: "\u0627\u0644\u0623\u0633\u0627\u0628\u064a\u0639",
      wins: "\u0627\u0644\u0641\u0648\u0632",
      sweeps: "\u062a\u0648\u0642\u0639 \u0643\u0627\u0645\u0644",
      topTeams: "\u0623\u0641\u0636\u0644 \u0627\u0644\u0641\u0631\u0642",
      member: "\u0627\u0644\u0639\u0636\u0648",
      previous: "\u0627\u0644\u0633\u0627\u0628\u0642",
      next: "\u0627\u0644\u062a\u0627\u0644\u064a",
      notAvailable: "\u063a\u064a\u0631 \u0645\u062a\u0627\u062d",
      notFoundTitle: "\u0627\u0644\u0635\u0641\u062d\u0629 \u063a\u064a\u0631 \u0645\u0648\u062c\u0648\u062f\u0629",
      notFoundBody: "\u0627\u0644\u0635\u0641\u062d\u0629 \u0627\u0644\u062a\u064a \u062a\u0628\u062d\u062b \u0639\u0646\u0647\u0627 \u063a\u064a\u0631 \u0645\u0648\u062c\u0648\u062f\u0629 \u0623\u0648 \u062a\u0645 \u0646\u0642\u0644\u0647\u0627.",
      errorTitle: "\u062d\u062f\u062b \u062e\u0637\u0623 \u0645\u0627",
      errorBody: "\u062d\u062f\u062b \u062e\u0637\u0623 \u063a\u064a\u0631 \u0645\u062a\u0648\u0642\u0639. \u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649.",
      retry: "\u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649",
      loadingLabel: "\u062c\u0627\u0631\u064d \u0627\u0644\u062a\u062d\u0645\u064a\u0644\u2026",
      termsOfService: "\u0634\u0631\u0648\u0637 \u0627\u0644\u062e\u062f\u0645\u0629",
      privacyPolicy: "\u0633\u064a\u0627\u0633\u0629 \u0627\u0644\u062e\u0635\u0648\u0635\u064a\u0629",
      newer: "\u0623\u062d\u062f\u062b",
      older: "\u0623\u0642\u062f\u0645",
    },
    home: {
      eyebrow: "\u0645\u062c\u062a\u0645\u0639\u0643",
      title: "\u0645\u062c\u062a\u0645\u0639 \u0627\u0644\u0631\u064a\u0627\u0636\u0627\u062a \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a\u0629 \u0641\u064a \u0645\u0643\u0627\u0646 \u0648\u0627\u062d\u062f.",
      description: "\u062a\u0627\u0628\u0639 \u0623\u0644\u0639\u0627\u0628\u0643 \u0627\u0644\u0645\u0641\u0636\u0644\u0629\u060c \u0648\u0627\u0637\u0651\u0644\u0639 \u0639\u0644\u0649 \u0622\u062e\u0631 \u0627\u0644\u0623\u062e\u0628\u0627\u0631\u060c \u0648\u062a\u0633\u0644\u0651\u0642 \u0644\u0648\u062d\u0629 \u062a\u0648\u0642\u0639\u0627\u062a \u0645\u062c\u062a\u0645\u0639\u0643.",
      openGames: "\u062a\u0635\u0641\u062d \u0627\u0644\u0623\u0644\u0639\u0627\u0628",
      openProfile: "\u0645\u0644\u0641\u064a",
      openLeaderboard: "\u0644\u0648\u062d\u0629 \u0627\u0644\u0635\u062f\u0627\u0631\u0629",
      gamesHeading: "\u0627\u0644\u0623\u0644\u0639\u0627\u0628",
      gamesSubtitle: "\u0627\u062f\u062e\u0644 \u0625\u0644\u0649 \u0627\u0644\u0623\u0644\u0639\u0627\u0628 \u0627\u0644\u062a\u064a \u064a\u062a\u0627\u0628\u0639\u0647\u0627 \u0645\u062c\u062a\u0645\u0639\u0643.",
      newsHeading: "\u0623\u062d\u062f\u062b \u0627\u0644\u0623\u062e\u0628\u0627\u0631",
      newsSubtitle: "\u0622\u062e\u0631 \u0627\u0644\u062a\u062d\u062f\u064a\u062b\u0627\u062a \u0645\u0646 \u0627\u0644\u0645\u062c\u062a\u0645\u0639.",
      featuredNews: "\u0645\u0645\u064a\u0632",
      readStory: "\u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u062e\u0628\u0631",
      moreNews: "\u062a\u062d\u062f\u064a\u062b\u0627\u062a \u0623\u062e\u0631\u0649",
      newsEmpty: "\u0644\u0627 \u062a\u0648\u062c\u062f \u0645\u0646\u0634\u0648\u0631\u0627\u062a \u0628\u0639\u062f \u2014 \u062a\u0627\u0628\u0639\u0646\u0627 \u0642\u0631\u064a\u0628\u064b\u0627.",
      seeAll: "\u0639\u0631\u0636 \u0627\u0644\u0643\u0644",
      liveHeading: "\u0645\u0628\u0627\u0634\u0631 \u0627\u0644\u0622\u0646",
      liveSubtitle: "\u0645\u0628\u0627\u0631\u064a\u0627\u062a \u062a\u064f\u0644\u0639\u0628 \u0627\u0644\u0622\u0646.",
      upcomingHeading: "\u0642\u0627\u062f\u0645",
      upcomingSubtitle: "\u0628\u0637\u0648\u0644\u0627\u062a \u0644\u062f\u064a\u0647\u0627 \u0645\u0628\u0627\u0631\u064a\u0627\u062a \u0642\u0627\u062f\u0645\u0629.",
      liveEmpty: "\u0644\u0627 \u062a\u0648\u062c\u062f \u0645\u0628\u0627\u0631\u064a\u0627\u062a \u0645\u0628\u0627\u0634\u0631\u0629 \u0623\u0648 \u0642\u0627\u062f\u0645\u0629 \u0627\u0644\u0622\u0646.",
      viewTournament: "\u0639\u0631\u0636",
      adminTitle: "\u0645\u0643\u062a\u0628 \u0627\u0644\u0625\u062f\u0627\u0631\u0629",
      adminDescription: "\u0645\u0633\u0627\u062d\u0629 \u062e\u0627\u0635\u0629 \u0644\u0645\u062d\u062a\u0648\u0649 \u0627\u0644\u0645\u062c\u062a\u0645\u0639 \u0648\u0635\u0641\u062d\u0627\u062a \u0627\u0644\u0623\u0644\u0639\u0627\u0628 \u0648\u0645\u0633\u0648\u062f\u0627\u062a \u0627\u0644\u0623\u062e\u0628\u0627\u0631 \u0648\u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u0628\u0648\u062a.",
      gamePagesTitle: "\u0635\u0641\u062d\u0627\u062a \u0627\u0644\u0623\u0644\u0639\u0627\u0628",
      gamePagesDescription: "\u0635\u0641\u062d\u0629 \u0639\u0627\u0645\u0629 \u0644\u0643\u0644 \u0644\u0639\u0628\u0629 \u0644\u0644\u062a\u063a\u0637\u064a\u0629 \u0648\u0627\u0644\u0645\u0646\u0634\u0648\u0631\u0627\u062a \u0648\u0627\u0644\u0631\u0648\u0627\u0628\u0637 \u0627\u0644\u0645\u0647\u0645\u0629 \u0648\u0633\u064a\u0627\u0642 \u0627\u0644\u0645\u062c\u062a\u0645\u0639.",
      newsTitle: "\u0627\u0644\u0623\u062e\u0628\u0627\u0631 \u0648\u0627\u0644\u0645\u0646\u0634\u0648\u0631\u0627\u062a",
      newsDescription: "\u062c\u0647\u0632 \u062a\u062d\u062f\u064a\u062b\u0627\u062a \u0645\u062e\u062a\u0635\u0631\u0629 \u0644\u0644\u0645\u0648\u0642\u0639 \u0648\u062c\u0645\u0647\u0648\u0631 \u062f\u064a\u0633\u0643\u0648\u0631\u062f.",
      predictionsTitle: "\u0644\u0648\u062d\u0627\u062a \u0627\u0644\u062a\u0648\u0642\u0639\u0627\u062a",
      predictionsDescription: "\u0644\u0648\u062d\u0627\u062a \u0627\u0644\u0635\u062f\u0627\u0631\u0629 \u0648\u0645\u0632\u0627\u0645\u0646\u0629 \u0645\u0644\u0641 \u062f\u064a\u0633\u0643\u0648\u0631\u062f \u062a\u0628\u0642\u0649 \u0643\u0648\u062d\u062f\u0629 \u062f\u0627\u062e\u0644 \u0645\u0631\u0643\u0632 \u0627\u0644\u0645\u062c\u062a\u0645\u0639.",
      profileTitle: "\u0645\u0644\u0641\u0627\u062a \u0627\u0644\u0623\u0639\u0636\u0627\u0621",
      profileDescription: "\u0627\u0644\u062a\u0631\u062a\u064a\u0628 \u0648\u0627\u0644\u0646\u0642\u0627\u0637 \u0648\u0623\u0641\u0636\u0644 \u0627\u0644\u0641\u0631\u0642 \u0648\u062d\u0627\u0644\u0629 \u0627\u0644\u0645\u0632\u0627\u0645\u0646\u0629.",
      leaderboardTitle: "\u0644\u0648\u062d\u0629 \u0635\u062f\u0627\u0631\u0629 \u0639\u0627\u0645\u0629",
      leaderboardDescription: "\u0634\u0627\u0631\u0643 \u0635\u0641\u062d\u0629 \u062a\u0631\u062a\u064a\u0628 \u0639\u0627\u0645\u0629 \u0644\u0623\u064a \u0633\u064a\u0631\u0641\u0631 \u0648\u0645\u0648\u0633\u0645 \u0628\u062f\u0648\u0646 \u062a\u0633\u062c\u064a\u0644 \u062f\u062e\u0648\u0644.",
      discordTitle: "\u0631\u0628\u0637 \u062f\u064a\u0633\u0643\u0648\u0631\u062f",
      discordDescription: "\u0623\u0648\u0627\u0645\u0631 \u0627\u0644\u0628\u0648\u062a \u062a\u0633\u062a\u0637\u064a\u0639 \u0627\u0644\u0631\u0628\u0637 \u0648\u0627\u0644\u0645\u0632\u0627\u0645\u0646\u0629 \u0648\u0641\u0635\u0644 \u0627\u0644\u0631\u0628\u0637.",
      routeHint: "\u0627\u0644\u0631\u0627\u0628\u0637 \u0627\u0644\u0639\u0627\u0645",
      noDefaultLeaderboard: "\u0627\u0641\u062a\u062d \u0631\u0627\u0628\u0637 \u0644\u0648\u062d\u0629 \u0627\u0644\u0635\u062f\u0627\u0631\u0629 \u0645\u0646 \u062f\u064a\u0633\u0643\u0648\u0631\u062f \u0623\u0648 \u0627\u0633\u062a\u062e\u062f\u0645 \u0635\u064a\u063a\u0629 \u0627\u0644\u0631\u0627\u0628\u0637 \u0627\u0644\u0639\u0627\u0645\u0629.",
      previewTitle: "\u0645\u0631\u0643\u0632 \u0645\u062c\u062a\u0645\u0639 \u0648\u0627\u062d\u062f \u0644\u0639\u062f\u0629 \u0623\u0639\u0645\u0627\u0644.",
      previewDescription: "\u0627\u0644\u0623\u0639\u0636\u0627\u0621 \u064a\u062d\u0635\u0644\u0648\u0646 \u0639\u0644\u0649 \u0645\u0648\u0642\u0639 \u0639\u0627\u0645 \u0648\u0627\u0636\u062d\u060c \u0648\u0627\u0644\u0641\u0631\u064a\u0642 \u064a\u062d\u0635\u0644 \u0639\u0644\u0649 \u0645\u0633\u0627\u0631 \u062e\u0627\u0635 \u0644\u0644\u0646\u0634\u0631 \u0648\u062a\u063a\u0637\u064a\u0629 \u0627\u0644\u0623\u0644\u0639\u0627\u0628 \u0648\u0623\u062f\u0648\u0627\u062a \u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u0628\u0648\u062a \u0627\u0644\u0645\u0633\u062a\u0642\u0628\u0644\u064a\u0629.",
      previewName: "#2 \u0625\u062c\u0645\u0627\u0644\u064a\u0627 | 1,240 \u0646\u0642\u0637\u0629",
      previewTeams: "Falcons\u060c T1\u060c Vitality",
      scoreboardLabel: "\u064a\u062f\u0639\u0645",
      scoreboardRows: [
        ["\u0627\u0644\u0623\u0639\u0636\u0627\u0621", "\u062a\u0635\u0641\u062d \u0635\u0641\u062d\u0627\u062a \u0627\u0644\u0623\u0644\u0639\u0627\u0628 \u0648\u0627\u0644\u0623\u062e\u0628\u0627\u0631 \u0648\u0644\u0648\u062d\u0627\u062a \u0627\u0644\u0635\u062f\u0627\u0631\u0629 \u0648\u0623\u062f\u0648\u0627\u062a \u0627\u0644\u0645\u0644\u0641"],
        ["\u0645\u0634\u0631\u0641\u0648 \u0627\u0644\u0623\u0644\u0639\u0627\u0628", "\u0635\u0641\u062d\u0627\u062a \u0645\u062e\u0635\u0635\u0629 \u0644\u0644\u062c\u062f\u0627\u0648\u0644 \u0648\u0627\u0644\u0646\u062a\u0627\u0626\u062c \u0648\u0627\u0644\u0631\u0648\u0627\u0628\u0637"],
        ["\u0645\u062f\u064a\u0631\u0648 \u0627\u0644\u062a\u0648\u0627\u0635\u0644", "\u0643\u062a\u0627\u0628\u0629 \u0645\u0646\u0634\u0648\u0631\u0627\u062a \u0642\u0635\u064a\u0631\u0629 \u0648\u0645\u0639\u0627\u064a\u0646\u062a\u0647\u0627 \u0642\u0628\u0644 \u0627\u0644\u0646\u0634\u0631"],
        ["\u0627\u0644\u0645\u0634\u0631\u0641\u0648\u0646", "\u0625\u062f\u0627\u0631\u0629 \u0648\u0627\u062c\u0647\u0627\u062a \u0627\u0644\u0645\u062c\u062a\u0645\u0639 \u0628\u062f\u0648\u0646 \u0625\u0638\u0647\u0627\u0631 \u0623\u062f\u0648\u0627\u062a \u0627\u0644\u0641\u0631\u064a\u0642 \u0644\u0644\u0639\u0627\u0645\u0629"],
      ],
      featureTitle: "\u0627\u0644\u0645\u062c\u062a\u0645\u0639 \u0623\u0648\u0644\u0627\u060c \u0648\u0627\u0644\u062a\u0648\u0642\u0639\u0627\u062a \u0636\u0645\u0646\u0647.",
      featureDescription: "\u062a\u0648\u0642\u0639\u0627\u062a EWC \u0648\u062d\u062f\u0629 \u062f\u0627\u062e\u0644 \u0645\u0631\u0643\u0632 \u0627\u0644\u0645\u062c\u062a\u0645\u0639 \u0648\u0644\u064a\u0633\u062a \u0647\u0648\u064a\u0629 \u0627\u0644\u0645\u0648\u0642\u0639 \u0628\u0627\u0644\u0643\u0627\u0645\u0644.",
    },
    games: {
      eyebrow: "\u0635\u0641\u062d\u0627\u062a \u0627\u0644\u0623\u0644\u0639\u0627\u0628",
      title: "\u0635\u0641\u062d\u0627\u062a \u0645\u062e\u0635\u0635\u0629 \u0644\u0643\u0644 \u0644\u0639\u0628\u0629 \u064a\u062a\u0627\u0628\u0639\u0647\u0627 \u0645\u062c\u062a\u0645\u0639\u0643.",
      description: "\u0627\u0645\u0646\u062d \u0645\u0634\u0631\u0641\u064a \u0627\u0644\u0623\u0644\u0639\u0627\u0628 \u0648\u0645\u062f\u064a\u0631\u064a \u0627\u0644\u062a\u0648\u0627\u0635\u0644 \u0645\u0643\u0627\u0646\u0627 \u0648\u0627\u0636\u062d\u0627 \u0644\u062a\u0646\u0638\u064a\u0645 \u0627\u0644\u062a\u063a\u0637\u064a\u0629 \u0648\u0646\u0634\u0631 \u0627\u0644\u0645\u0644\u062e\u0635\u0627\u062a \u0648\u0645\u0634\u0627\u0631\u0643\u0629 \u0627\u0644\u0631\u0648\u0627\u0628\u0637 \u0641\u064a \u062f\u064a\u0633\u0643\u0648\u0631\u062f.",
      openGame: "\u0627\u0641\u062a\u062d \u0627\u0644\u0644\u0639\u0628\u0629",
      newsLabel: "\u0623\u062e\u0628\u0627\u0631 \u0627\u0644\u0645\u062c\u062a\u0645\u0639",
      newsTitle: "\u0645\u0646\u0634\u0648\u0631\u0627\u062a \u064a\u0645\u0643\u0646 \u0623\u0646 \u062a\u0646\u062a\u0642\u0644 \u0645\u0646 \u0627\u0644\u0645\u0648\u0642\u0639 \u0625\u0644\u0649 \u062f\u064a\u0633\u0643\u0648\u0631\u062f.",
      newsDescription: "\u062a\u0628\u0642\u064a \u0635\u0641\u062d\u0627\u062a \u0627\u0644\u0623\u0644\u0639\u0627\u0628 \u0627\u0644\u062a\u062d\u062f\u064a\u062b\u0627\u062a \u0627\u0644\u0642\u0635\u064a\u0631\u0629 \u0642\u0631\u064a\u0628\u0629 \u0645\u0646 \u0633\u064a\u0627\u0642 \u0627\u0644\u0644\u0639\u0628\u0629.",
    },
    tournaments: {
      eyebrow: "\u0627\u0644\u0628\u0637\u0648\u0644\u0627\u062a",
      title: "\u0627\u0644\u0628\u0637\u0648\u0644\u0627\u062a \u0627\u0644\u0645\u062a\u0627\u0628\u064e\u0639\u0629",
      description: "\u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u0645\u0628\u0627\u0631\u064a\u0627\u062a \u0627\u0644\u0645\u0628\u0627\u0634\u0631\u0629 \u0645\u0646 \u0627\u0644\u0641\u0639\u0627\u0644\u064a\u0627\u062a \u0627\u0644\u062a\u064a \u064a\u062a\u0627\u0628\u0639\u0647\u0627 \u0627\u0644\u0645\u062c\u062a\u0645\u0639.",
      empty: "\u0644\u0627 \u062a\u0648\u062c\u062f \u0628\u0637\u0648\u0644\u0627\u062a \u0645\u062a\u0627\u0628\u064e\u0639\u0629 \u0628\u0639\u062f.",
      archiveLink: "\u0639\u0631\u0636 \u0627\u0644\u0628\u0637\u0648\u0644\u0627\u062a \u0627\u0644\u0645\u0646\u062a\u0647\u064a\u0629",
      archiveTitle: "\u0627\u0644\u0628\u0637\u0648\u0644\u0627\u062a \u0627\u0644\u0645\u0646\u062a\u0647\u064a\u0629",
      archiveDescription: "\u0623\u0631\u0634\u064a\u0641 \u0627\u0644\u0628\u0637\u0648\u0644\u0627\u062a \u0627\u0644\u062a\u064a \u0627\u0646\u062a\u0647\u062a \u0643\u0644 \u0645\u0628\u0627\u0631\u064a\u0627\u062a\u0647\u0627 \u0648\u0628\u0642\u064a\u062a \u0646\u062a\u0627\u0626\u062c\u0647\u0627 \u0645\u062a\u0627\u062d\u0629 \u0644\u0644\u0645\u0631\u0627\u062c\u0639\u0629.",
      archiveEmpty: "\u0644\u0627 \u062a\u0648\u062c\u062f \u0628\u0637\u0648\u0644\u0627\u062a \u0645\u0646\u062a\u0647\u064a\u0629 \u0641\u064a \u0627\u0644\u0623\u0631\u0634\u064a\u0641 \u0628\u0639\u062f.",
      activeLink: "\u0627\u0644\u0639\u0648\u062f\u0629 \u0625\u0644\u0649 \u0627\u0644\u0628\u0637\u0648\u0644\u0627\u062a \u0627\u0644\u0645\u062a\u0627\u0628\u064e\u0639\u0629",
      archivedBadge: "\u0645\u0624\u0631\u0634\u0641\u0629",
      noFiltered: "\u0644\u0627 \u062a\u0648\u062c\u062f \u0628\u0637\u0648\u0644\u0627\u062a \u062a\u0637\u0627\u0628\u0642 \u0647\u0630\u0647 \u0627\u0644\u0641\u0644\u0627\u062a\u0631.",
      filters: "\u0627\u0644\u0641\u0644\u0627\u062a\u0631",
      searchPlaceholder: "\u0627\u0628\u062d\u062b \u0639\u0646 \u0628\u0637\u0648\u0644\u0629 \u0623\u0648 \u0641\u0631\u064a\u0642 \u0623\u0648 \u0644\u0639\u0628\u0629",
      allGames: "\u0643\u0644 \u0627\u0644\u0623\u0644\u0639\u0627\u0628",
      allStatuses: "\u0643\u0644 \u0627\u0644\u062d\u0627\u0644\u0627\u062a",
      allSources: "\u0643\u0644 \u0627\u0644\u0645\u0635\u0627\u062f\u0631",
      clearFilters: "\u0645\u0633\u062d \u0627\u0644\u0641\u0644\u0627\u062a\u0631",
      showing: "\u064a\u0639\u0631\u0636",
      trackedGames: "\u0623\u0644\u0639\u0627\u0628 \u0645\u062a\u0627\u0628\u064e\u0639\u0629",
      trackedTournaments: "\u0628\u0637\u0648\u0644\u0627\u062a \u0645\u062a\u0627\u0628\u064e\u0639\u0629",
      liveTournaments: "\u0628\u0637\u0648\u0644\u0627\u062a \u0645\u0628\u0627\u0634\u0631\u0629",
      upcomingTournaments: "\u0628\u0637\u0648\u0644\u0627\u062a \u0642\u0627\u062f\u0645\u0629",
      resultsTournaments: "\u0628\u0637\u0648\u0644\u0627\u062a \u0644\u0647\u0627 \u0646\u062a\u0627\u0626\u062c",
      live: "\u0645\u0628\u0627\u0634\u0631",
      upcoming: "\u0627\u0644\u0642\u0627\u062f\u0645\u0629",
      finished: "\u0627\u0644\u0645\u0646\u062a\u0647\u064a\u0629",
      source: "\u0627\u0644\u0645\u0635\u062f\u0631",
      eventSource: "\u0645\u0635\u062f\u0631 \u0627\u0644\u0628\u0637\u0648\u0644\u0629",
      featuredMatch: "\u0645\u0628\u0627\u0631\u0627\u0629 \u0628\u0627\u0631\u0632\u0629",
      nextMatch: "\u0627\u0644\u0645\u0628\u0627\u0631\u0627\u0629 \u0627\u0644\u0642\u0627\u062f\u0645\u0629",
      latestResult: "\u0622\u062e\u0631 \u0646\u062a\u064a\u062c\u0629",
      openTournament: "\u0627\u0641\u062a\u062d \u0627\u0644\u0628\u0637\u0648\u0644\u0629",
      viewMatches: "\u0639\u0631\u0636 \u0627\u0644\u0645\u0628\u0627\u0631\u064a\u0627\u062a",
      back: "\u0627\u0644\u0639\u0648\u062f\u0629 \u0625\u0644\u0649 \u0627\u0644\u0628\u0637\u0648\u0644\u0627\u062a",
      liveNow: "\u0645\u0628\u0627\u0634\u0631 \u0627\u0644\u0622\u0646",
      coStreaming: "\u0628\u062b \u0645\u0635\u0627\u062d\u0628",
      watchNow: "\u0634\u0627\u0647\u062f \u0627\u0644\u0622\u0646",
      results: "\u0623\u062d\u062f\u062b \u0627\u0644\u0646\u062a\u0627\u0626\u062c",
      noLive: "\u0644\u0627 \u062a\u0648\u062c\u062f \u0645\u0628\u0627\u0631\u064a\u0627\u062a \u0645\u0628\u0627\u0634\u0631\u0629 \u0627\u0644\u0622\u0646.",
      noUpcoming: "\u0644\u0627 \u062a\u0648\u062c\u062f \u0645\u0628\u0627\u0631\u064a\u0627\u062a \u0642\u0627\u062f\u0645\u0629.",
      noResults: "\u0644\u0627 \u062a\u0648\u062c\u062f \u0646\u062a\u0627\u0626\u062c \u0628\u0639\u062f.",
      noMatches: "\u0644\u0627 \u062a\u0648\u062c\u062f \u0645\u0628\u0627\u0631\u064a\u0627\u062a \u0644\u0647\u0630\u0647 \u0627\u0644\u0628\u0637\u0648\u0644\u0629 \u0628\u0639\u062f.",
      time: "\u0627\u0644\u0648\u0642\u062a",
      match: "\u0627\u0644\u0645\u0628\u0627\u0631\u0627\u0629",
      score: "\u0627\u0644\u0646\u062a\u064a\u062c\u0629",
      result: "\u0627\u0644\u0646\u062a\u064a\u062c\u0629",
      standings: "\u062c\u062f\u0648\u0644 \u0627\u0644\u062a\u0631\u062a\u064a\u0628",
      participants: "\u0627\u0644\u0641\u0631\u0642 \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0629",
      rank: "\u0627\u0644\u0645\u0631\u0643\u0632",
      seed: "\u0627\u0644\u062a\u0635\u0646\u064a\u0641",
      team: "\u0627\u0644\u0641\u0631\u064a\u0642",
      points: "\u0627\u0644\u0646\u0642\u0627\u0637",
      vs: "\u0636\u062f",
      tbd: "\u063a\u064a\u0631 \u0645\u062d\u062f\u062f",
      timeTbd: "\u0648\u0642\u062a \u063a\u064a\u0631 \u0645\u062d\u062f\u062f",
      today: "\u0627\u0644\u064a\u0648\u0645",
      tomorrow: "\u063a\u062f\u064b\u0627",
      winner: "\u0627\u0644\u0641\u0627\u0626\u0632",
      draw: "\u062a\u0639\u0627\u062f\u0644",
      openSource: "\u0639\u0631\u0636 \u0639\u0644\u0649 \u0627\u0644\u0645\u0635\u062f\u0631",
      attribution: "\u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a \u0645\u0646 Liquipedia \u2014 CC-BY-SA 3.0",
      attributionView: "liquipedia.net",
      attributionLicense: "CC-BY-SA 3.0",
    },
    game: {
      back: "\u0627\u0644\u0639\u0648\u062f\u0629 \u0644\u0644\u0623\u0644\u0639\u0627\u0628",
      admin: "\u0627\u0644\u0625\u062f\u0627\u0631\u0629",
      owner: "\u0627\u0644\u0645\u0633\u0624\u0648\u0644",
      postsTitle: "\u0623\u062d\u062f\u062b \u0627\u0644\u0645\u0646\u0634\u0648\u0631\u0627\u062a",
      postsEmpty: "\u0644\u0627 \u062a\u0648\u062c\u062f \u0645\u0646\u0634\u0648\u0631\u0627\u062a \u0628\u0639\u062f. \u062a\u0627\u0628\u0639\u0646\u0627 \u0642\u0631\u064a\u0628\u064b\u0627.",
      readMore: "\u0627\u0642\u0631\u0623 \u0627\u0644\u0645\u0646\u0634\u0648\u0631",
      published: "\u0645\u0646\u0634\u0648\u0631",
    },
    leaderboard: {
      back: "\u0627\u0644\u0639\u0648\u062f\u0629 \u0644\u0644\u0631\u0626\u064a\u0633\u064a\u0629",
      badge: "\u0644\u0648\u062d\u0629 \u0639\u0627\u0645\u0629",
      rankedMembers: "\u0627\u0644\u0623\u0639\u0636\u0627\u0621 \u0627\u0644\u0645\u0635\u0646\u0641\u0648\u0646",
      topScore: "\u0623\u0639\u0644\u0649 \u0646\u0642\u0627\u0637",
      searchPlaceholder: "\u0627\u0628\u062d\u062b \u0639\u0646 \u0639\u0636\u0648 \u0623\u0648 \u0641\u0631\u064a\u0642",
      empty: "\u0644\u0627 \u062a\u0648\u062c\u062f \u062a\u0648\u0642\u0639\u0627\u062a \u0645\u0635\u0646\u0641\u0629 \u062d\u062a\u0649 \u0627\u0644\u0622\u0646.",
      noBoardTitle: "\u0644\u0627 \u062a\u0648\u062c\u062f \u0644\u0648\u062d\u0629 \u0635\u062f\u0627\u0631\u0629 \u0628\u0639\u062f",
      noBoardDescription: "\u0628\u0645\u062c\u0631\u062f \u0623\u0646 \u064a\u064f\u0637\u0644\u0642 \u0627\u0644\u0645\u062c\u062a\u0645\u0639 \u0645\u0648\u0633\u0645 \u062a\u0648\u0642\u0639\u0627\u062a\u060c \u0633\u064a\u0638\u0647\u0631 \u062a\u0631\u062a\u064a\u0628\u0647 \u0647\u0646\u0627 \u062a\u0644\u0642\u0627\u0626\u064a\u064b\u0627.",
    },
    profile: {
      eyebrow: "\u0644\u0648\u062d\u0629 EWC",
      title: "\u0645\u0644\u0641 \u062a\u0648\u0642\u0639\u0627\u062a\u064a",
      discordPending: "\u062d\u0633\u0627\u0628 \u062f\u064a\u0633\u0643\u0648\u0631\u062f \u063a\u064a\u0631 \u0645\u0631\u0628\u0648\u0637",
      leaderboard: "\u0644\u0648\u062d\u0629 \u0627\u0644\u0635\u062f\u0627\u0631\u0629",
      sync: "\u062a\u062d\u062f\u064a\u062b",
      unlink: "\u0641\u0635\u0644 \u0627\u0644\u0631\u0628\u0637",
      unavailableTitle: "\u0627\u0644\u0645\u0644\u0641 \u063a\u064a\u0631 \u0645\u062a\u0627\u062d",
      noProfileTitle: "\u0644\u0627 \u064a\u0648\u062c\u062f \u0645\u0644\u0641 \u062a\u0648\u0642\u0639\u0627\u062a \u0628\u0639\u062f",
      noProfileDescription: "\u0644\u0644\u062d\u0635\u0648\u0644 \u0639\u0644\u0649 \u0645\u0644\u0641\u060c \u0642\u062f\u0651\u0645 \u062a\u0648\u0642\u0639\u0627\u062a\u0643 \u0641\u064a \u062f\u064a\u0633\u0643\u0648\u0631\u062f \u0639\u0628\u0631 /ewc_predict weekly \u0648/ewc_predict season\u060c \u062b\u0645 \u0627\u0631\u0628\u0637 \u0645\u0644\u0641\u0643 \u0628\u0623\u0645\u0631 /ewc_predict link.",
      lastSyncFailed: "\u0641\u0634\u0644 \u0622\u062e\u0631 \u062a\u062d\u062f\u064a\u062b",
      syncFailed: "\u0641\u0634\u0644 \u0627\u0644\u062a\u062d\u062f\u064a\u062b",
      unlinkFailed: "\u0641\u0634\u0644 \u0641\u0635\u0644 \u0627\u0644\u0631\u0628\u0637",
      unranked: "\u063a\u064a\u0631 \u0645\u0635\u0646\u0641",
      points: "\u0627\u0644\u0646\u0642\u0627\u0637",
      weeksScored: "\u0623\u0633\u0627\u0628\u064a\u0639 \u0645\u062d\u0633\u0648\u0628\u0629",
      weeklyWins: "\u0627\u0646\u062a\u0635\u0627\u0631\u0627\u062a \u0623\u0633\u0628\u0648\u0639\u064a\u0629",
      showcase: "\u0627\u0644\u0627\u0633\u062a\u0639\u0631\u0627\u0636",
      seasonPicks: "\u0627\u062e\u062a\u064a\u0627\u0631\u0627\u062a \u0627\u0644\u0645\u0648\u0633\u0645",
      weeklyHistory: "\u0627\u0644\u0633\u062c\u0644 \u0627\u0644\u0623\u0633\u0628\u0648\u0639\u064a",
      synced: "\u062a\u0645 \u0627\u0644\u062a\u062d\u062f\u064a\u062b",
      notScored: "\u0644\u0645 \u064a\u062a\u0645 \u0627\u062d\u062a\u0633\u0627\u0628\u0647 \u0628\u0639\u062f",
      noSeasonPicks: "\u0644\u0627 \u062a\u0648\u062c\u062f \u0627\u062e\u062a\u064a\u0627\u0631\u0627\u062a \u0644\u0644\u0645\u0648\u0633\u0645 \u062d\u062a\u0649 \u0627\u0644\u0622\u0646.",
      recentWeekly: "\u0622\u062e\u0631 \u0627\u0644\u062c\u0648\u0644\u0627\u062a \u0627\u0644\u0623\u0633\u0628\u0648\u0639\u064a\u0629",
      noWeeklyPicks: "\u0644\u0627 \u062a\u0648\u062c\u062f \u0627\u062e\u062a\u064a\u0627\u0631\u0627\u062a \u0623\u0633\u0628\u0648\u0639\u064a\u0629 \u062d\u062a\u0649 \u0627\u0644\u0622\u0646.",
      noPicks: "\u0644\u0627 \u062a\u0648\u062c\u062f \u0627\u062e\u062a\u064a\u0627\u0631\u0627\u062a",
      sweepBonus: "\u0645\u0643\u0627\u0641\u0623\u0629 \u062a\u0648\u0642\u0639 \u0623\u0648\u0644 \u062b\u0644\u0627\u062b\u0629",
    },
    follows: {
      follow: "\u0645\u062a\u0627\u0628\u0639\u0629",
      following: "\u062a\u062a\u0627\u0628\u0639\u0647",
      unfollow: "\u0625\u0644\u063a\u0627\u0621 \u0627\u0644\u0645\u062a\u0627\u0628\u0639\u0629",
      signInToFollow: "\u0633\u062c\u0651\u0644 \u0627\u0644\u062f\u062e\u0648\u0644 \u0644\u0644\u0645\u062a\u0627\u0628\u0639\u0629",
      followingTitle: "\u0627\u0644\u0645\u062a\u0627\u0628\u0639\u0627\u062a",
      followingDescription: "\u0627\u0644\u0623\u0644\u0639\u0627\u0628 \u0648\u0627\u0644\u0628\u0637\u0648\u0644\u0627\u062a \u0648\u0627\u0644\u0641\u0631\u0642 \u0648\u0627\u0644\u0644\u0627\u0639\u0628\u0648\u0646 \u0627\u0644\u0630\u064a\u0646 \u062a\u0635\u0644\u0643 \u062a\u0646\u0628\u064a\u0647\u0627\u062a \u0645\u0628\u0627\u0631\u064a\u0627\u062a\u0647\u0645.",
      noFollows: "\u0644\u0627 \u062a\u062a\u0627\u0628\u0639 \u0623\u064a \u0634\u064a\u0621 \u0628\u0639\u062f. \u0627\u0633\u062a\u062e\u062f\u0645 \u0632\u0631 \u0627\u0644\u0645\u062a\u0627\u0628\u0639\u0629 \u0641\u064a \u0635\u0641\u062d\u0629 \u0623\u064a \u0644\u0639\u0628\u0629 \u0623\u0648 \u0628\u0637\u0648\u0644\u0629 \u0623\u0648 \u0641\u0631\u064a\u0642 \u0623\u0648 \u0644\u0627\u0639\u0628.",
      notificationsTitle: "\u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062a",
      notificationsDescription: "\u062a\u0646\u0628\u064a\u0647\u0627\u062a \u0627\u0644\u0645\u0628\u0627\u0631\u064a\u0627\u062a \u0644\u0643\u0644 \u0645\u0627 \u062a\u062a\u0627\u0628\u0639\u0647.",
      noNotifications: "\u0644\u0627 \u062a\u0648\u062c\u062f \u0625\u0634\u0639\u0627\u0631\u0627\u062a \u0628\u0639\u062f.",
      unreadCount: (count: number) =>
        count === 1 ? "\u0625\u0634\u0639\u0627\u0631 \u0648\u0627\u062d\u062f \u063a\u064a\u0631 \u0645\u0642\u0631\u0648\u0621" : count === 2 ? "\u0625\u0634\u0639\u0627\u0631\u0627\u0646 \u063a\u064a\u0631 \u0645\u0642\u0631\u0648\u0621\u064a\u0646" : `${count} \u063a\u064a\u0631 \u0645\u0642\u0631\u0648\u0621\u0629`,
      markAllRead: "\u062a\u062d\u062f\u064a\u062f \u0627\u0644\u0643\u0644 \u0643\u0645\u0642\u0631\u0648\u0621",
      matchStart: "\u0628\u062f\u0623\u062a \u0627\u0644\u0645\u0628\u0627\u0631\u0627\u0629",
      matchResult: "\u0627\u0644\u0646\u062a\u064a\u062c\u0629 \u0627\u0644\u0646\u0647\u0627\u0626\u064a\u0629",
      settingsTitle: "\u0625\u0639\u062f\u0627\u062f\u0627\u062a \u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062a",
      settingsDescription: "\u0627\u062e\u062a\u0631 \u0645\u0627 \u062a\u0631\u064a\u062f \u0623\u0646 \u062a\u0635\u0644\u0643 \u0625\u0634\u0639\u0627\u0631\u0627\u062a \u0639\u0646\u0647 \u0648\u0623\u064a\u0646 \u062a\u0635\u0644\u0643.",
      dmEnabled: "\u0631\u0633\u0627\u0626\u0644 \u062f\u064a\u0633\u0643\u0648\u0631\u062f \u0627\u0644\u062e\u0627\u0635\u0629",
      dmEnabledHelp: "\u0627\u0633\u062a\u0644\u0645 \u0627\u0644\u062a\u0646\u0628\u064a\u0647\u0627\u062a \u0623\u064a\u0636\u064b\u0627 \u0643\u0631\u0633\u0627\u0644\u0629 \u062e\u0627\u0635\u0629 \u0639\u0644\u0649 \u062f\u064a\u0633\u0643\u0648\u0631\u062f.",
      notifyMatchStart: "\u0628\u062f\u0627\u064a\u0629 \u0627\u0644\u0645\u0628\u0627\u0631\u0627\u0629",
      notifyMatchStartHelp: "\u0639\u0646\u062f\u0645\u0627 \u064a\u0628\u062f\u0623 \u0628\u062b \u0645\u0628\u0627\u0631\u0627\u0629 \u0644\u0641\u0631\u064a\u0642 \u0623\u0648 \u0644\u0627\u0639\u0628 \u0623\u0648 \u0628\u0637\u0648\u0644\u0629 \u0623\u0648 \u0644\u0639\u0628\u0629 \u062a\u062a\u0627\u0628\u0639\u0647\u0627.",
      notifyMatchResult: "\u0646\u062a\u0627\u0626\u062c \u0627\u0644\u0645\u0628\u0627\u0631\u064a\u0627\u062a",
      notifyMatchResultHelp: "\u0639\u0646\u062f\u0645\u0627 \u062a\u0646\u062a\u0647\u064a \u0645\u0628\u0627\u0631\u0627\u0629 \u062a\u062a\u0627\u0628\u0639\u0647\u0627 \u0628\u0646\u062a\u064a\u062c\u0629 \u0646\u0647\u0627\u0626\u064a\u0629.",
      entityTypes: {
        game: "\u0644\u0639\u0628\u0629",
        tournament: "\u0628\u0637\u0648\u0644\u0629",
        team: "\u0641\u0631\u064a\u0642",
        player: "\u0644\u0627\u0639\u0628",
      },
      loadFailed: "\u062a\u0639\u0630\u0631 \u0627\u0644\u062a\u062d\u0645\u064a\u0644. \u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649.",
      updateFailed: "\u062a\u0639\u0630\u0631 \u0627\u0644\u062a\u062d\u062f\u064a\u062b. \u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649.",
    },
    profiles: {
      teams: "\u0627\u0644\u0641\u0631\u0642",
      players: "\u0627\u0644\u0644\u0627\u0639\u0628\u0648\u0646",
      teamsDirectoryTitle: "\u0627\u0644\u0641\u0631\u0642",
      teamsDirectoryDescription: "\u062a\u0635\u0641\u0651\u062d \u0641\u0631\u0642 \u0627\u0644\u0623\u0644\u0639\u0627\u0628 \u0627\u0644\u062a\u064a \u064a\u062a\u0627\u0628\u0639\u0647\u0627 \u0627\u0644\u0645\u062c\u062a\u0645\u0639 \u2014 \u0627\u0644\u0642\u0648\u0627\u0626\u0645 \u0648\u0627\u0644\u0645\u0646\u0627\u0637\u0642 \u0648\u0627\u0644\u0645\u0644\u0641\u0627\u062a.",
      playersDirectoryTitle: "\u0627\u0644\u0644\u0627\u0639\u0628\u0648\u0646",
      playersDirectoryDescription: "\u062a\u0635\u0641\u0651\u062d \u0627\u0644\u0644\u0627\u0639\u0628\u064a\u0646 \u0627\u0644\u0645\u062d\u062a\u0631\u0641\u064a\u0646 \u0641\u064a \u0627\u0644\u0623\u0644\u0639\u0627\u0628 \u0627\u0644\u062a\u064a \u064a\u062a\u0627\u0628\u0639\u0647\u0627 \u0627\u0644\u0645\u062c\u062a\u0645\u0639.",
      searchPlaceholder: "\u0627\u0628\u062d\u062b \u0628\u0627\u0644\u0627\u0633\u0645",
      searchAction: "\u0628\u062d\u062b",
      allGames: "\u0643\u0644 \u0627\u0644\u0623\u0644\u0639\u0627\u0628",
      noResults: "\u0644\u0627 \u062a\u0648\u062c\u062f \u0646\u062a\u0627\u0626\u062c \u0645\u0637\u0627\u0628\u0642\u0629 \u0628\u0639\u062f. \u062a\u062a\u0645 \u0645\u0632\u0627\u0645\u0646\u0629 \u0627\u0644\u0645\u0644\u0641\u0627\u062a \u0644\u064a\u0644\u064b\u0627\u060c \u0644\u0630\u0627 \u062a\u0638\u0647\u0631 \u0641\u0631\u0642 \u0648\u0644\u0627\u0639\u0628\u0648\u0646 \u062c\u062f\u062f \u0645\u0639 \u0627\u0644\u0648\u0642\u062a.",
      resultsCount: (count: number) =>
        count === 1 ? "\u0646\u062a\u064a\u062c\u0629 \u0648\u0627\u062d\u062f\u0629" : count === 2 ? "\u0646\u062a\u064a\u062c\u062a\u0627\u0646" : count <= 10 ? `${count} \u0646\u062a\u0627\u0626\u062c` : `${count} \u0646\u062a\u064a\u062c\u0629`,
      prevPage: "\u0627\u0644\u0633\u0627\u0628\u0642",
      nextPage: "\u0627\u0644\u062a\u0627\u0644\u064a",
      pageLabel: (page: number) => `\u0635\u0641\u062d\u0629 ${page}`,
      viewAllTeams: "\u062a\u0635\u0641\u0651\u062d \u0643\u0644 \u0627\u0644\u0641\u0631\u0642",
      viewAllPlayers: "\u062a\u0635\u0641\u0651\u062d \u0643\u0644 \u0627\u0644\u0644\u0627\u0639\u0628\u064a\u0646",
      teamProfile: "\u0645\u0644\u0641 \u0627\u0644\u0641\u0631\u064a\u0642",
      playerProfile: "\u0645\u0644\u0641 \u0627\u0644\u0644\u0627\u0639\u0628",
      roster: "\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0644\u0627\u0639\u0628\u064a\u0646",
      noRoster: "\u0644\u0627 \u064a\u0648\u062c\u062f \u0644\u0627\u0639\u0628\u0648\u0646 \u0645\u062a\u0632\u0627\u0645\u0646\u0648\u0646 \u0644\u0647\u0630\u0627 \u0627\u0644\u0641\u0631\u064a\u0642 \u0628\u0639\u062f.",
      backToGames: "\u0627\u0644\u0639\u0648\u062f\u0629 \u0644\u0644\u0623\u0644\u0639\u0627\u0628",
      backToTeams: "\u0627\u0644\u0639\u0648\u062f\u0629 \u0644\u0644\u0641\u0631\u0642",
      backToPlayers: "\u0627\u0644\u0639\u0648\u062f\u0629 \u0644\u0644\u0627\u0639\u0628\u064a\u0646",
      pandascoreSource: "\u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u0645\u0644\u0641 \u0645\u0646 PandaScore",
      profileSourceMixed: "\u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u0645\u0644\u0641 \u0645\u0646 Liquipedia \u0648PandaScore",
      liquipediaInfo: "\u0645\u0639\u0644\u0648\u0645\u0627\u062a \u0627\u0644\u0644\u0627\u0639\u0628",
      game: "\u0627\u0644\u0644\u0639\u0628\u0629",
      romanizedName: "\u0627\u0644\u0627\u0633\u0645 \u0628\u0627\u0644\u0623\u062d\u0631\u0641 \u0627\u0644\u0644\u0627\u062a\u064a\u0646\u064a\u0629",
      status: "\u0627\u0644\u062d\u0627\u0644\u0629",
      nationality: "\u0627\u0644\u062c\u0646\u0633\u064a\u0629",
      location: "\u0627\u0644\u0645\u0648\u0642\u0639",
      acronym: "\u0627\u0644\u0627\u062e\u062a\u0635\u0627\u0631",
      role: "\u0627\u0644\u062f\u0648\u0631",
      currentTeam: "\u0627\u0644\u0641\u0631\u064a\u0642 \u0627\u0644\u062d\u0627\u0644\u064a",
      totalWinnings: "\u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u062c\u0648\u0627\u0626\u0632 \u0627\u0644\u062a\u0642\u0631\u064a\u0628\u064a",
      achievements: "\u0627\u0644\u0625\u0646\u062c\u0627\u0632\u0627\u062a",
      history: "\u0627\u0644\u062a\u0627\u0631\u064a\u062e",
      updated: "\u0622\u062e\u0631 \u062a\u062d\u062f\u064a\u062b",
      lastSeen: "\u0622\u062e\u0631 \u0638\u0647\u0648\u0631",
      unknownTeam: "\u0644\u0645 \u062a\u062a\u0645 \u0645\u0632\u0627\u0645\u0646\u0629 \u0627\u0644\u0641\u0631\u064a\u0642 \u0628\u0639\u062f",
      noImage: "\u0644\u0627 \u062a\u0648\u062c\u062f \u0635\u0648\u0631\u0629",
      viewTeam: "\u0639\u0631\u0636 \u0627\u0644\u0641\u0631\u064a\u0642",
      viewPlayer: "\u0639\u0631\u0636 \u0627\u0644\u0644\u0627\u0639\u0628",
    },
    login: {
      title: "\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062f\u062e\u0648\u0644 \u0628\u062f\u064a\u0633\u0643\u0648\u0631\u062f",
      description: "\u0627\u0631\u0628\u0637 \u062d\u0633\u0627\u0628\u0643 \u0641\u064a \u062f\u064a\u0633\u0643\u0648\u0631\u062f \u0644\u0625\u062f\u0627\u0631\u0629 \u0623\u062f\u0648\u0627\u062a \u0645\u0644\u0641\u0643.",
      failedTitle: "\u0641\u0634\u0644 \u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062f\u062e\u0648\u0644",
      failedMessage: "\u0641\u0634\u0644 \u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062f\u062e\u0648\u0644 \u0639\u0628\u0631 \u062f\u064a\u0633\u0643\u0648\u0631\u062f.",
      continue: "\u0627\u0644\u0645\u062a\u0627\u0628\u0639\u0629 \u0639\u0628\u0631 \u062f\u064a\u0633\u0643\u0648\u0631\u062f",
    },
    adminErrors: {
      "title-required": "\u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u0644\u0639\u0628\u0629 \u0645\u0637\u0644\u0648\u0628 \u0628\u0627\u0644\u0644\u063a\u062a\u064a\u0646 \u0627\u0644\u0639\u0631\u0628\u064a\u0629 \u0648\u0627\u0644\u0625\u0646\u062c\u0644\u064a\u0632\u064a\u0629",
      "title-too-long": "\u0627\u0644\u0639\u0646\u0648\u0627\u0646 \u0637\u0648\u064a\u0644 \u062c\u062f\u0627\u064b",
      "description-too-long": "\u0627\u0644\u0648\u0635\u0641 \u0637\u0648\u064a\u0644 \u062c\u062f\u0627\u064b",
      "status-too-long": "\u0646\u0635 \u0634\u0627\u0631\u0629 \u0627\u0644\u062d\u0627\u0644\u0629 \u0637\u0648\u064a\u0644 \u062c\u062f\u0627\u064b",
      "owner-too-long": "\u062d\u0642\u0644 \u0627\u0644\u0645\u0633\u0624\u0648\u0644 \u0637\u0648\u064a\u0644 \u062c\u062f\u0627\u064b",
      "focus-too-many": "\u0639\u062f\u062f \u0648\u0633\u0648\u0645 \u0627\u0644\u062a\u0631\u0643\u064a\u0632 \u062a\u062c\u0627\u0648\u0632 \u0627\u0644\u062d\u062f \u0627\u0644\u0645\u0633\u0645\u0648\u062d",
      "focus-item-too-long": "\u0623\u062d\u062f \u0648\u0633\u0648\u0645 \u0627\u0644\u062a\u0631\u0643\u064a\u0632 \u0637\u0648\u064a\u0644 \u062c\u062f\u0627\u064b",
      "name-required": "\u0627\u0633\u0645 \u0627\u0644\u0642\u0646\u0627\u0629 \u0645\u0637\u0644\u0648\u0628 \u0628\u0627\u0644\u0644\u063a\u062a\u064a\u0646 \u0627\u0644\u0639\u0631\u0628\u064a\u0629 \u0648\u0627\u0644\u0625\u0646\u062c\u0644\u064a\u0632\u064a\u0629",
      "name-too-long": "\u0627\u0644\u0627\u0633\u0645 \u0637\u0648\u064a\u0644 \u062c\u062f\u0627\u064b",
      "logo-url-too-long": "\u0631\u0627\u0628\u0637 \u0627\u0644\u0634\u0639\u0627\u0631 \u0637\u0648\u064a\u0644 \u062c\u062f\u0627\u064b",
      "logo-url-invalid": "\u064a\u062c\u0628 \u0623\u0646 \u064a\u0643\u0648\u0646 \u0631\u0627\u0628\u0637 \u0627\u0644\u0634\u0639\u0627\u0631 \u0639\u0646\u0648\u0627\u0646 http(s) \u0635\u062d\u064a\u062d\u0627\u064b",
      "link-url-invalid": "\u064a\u062c\u0628 \u0623\u0646 \u064a\u0643\u0648\u0646 \u0631\u0627\u0628\u0637 \u0627\u0644\u0642\u0646\u0627\u0629 \u0639\u0646\u0648\u0627\u0646 http(s) \u0635\u062d\u064a\u062d\u0627\u064b",
      "news-channel-invalid": "\u0645\u0639\u0631\u0651\u0641 \u0642\u0646\u0627\u0629 \u062f\u064a\u0633\u0643\u0648\u0631\u062f \u064a\u062c\u0628 \u0623\u0646 \u064a\u0643\u0648\u0646 \u0631\u0642\u0645\u0627\u064b \u0645\u0646 17 \u0625\u0644\u0649 20 \u062e\u0627\u0646\u0629",
    },
    composer: {
      newPost: "\u0645\u0646\u0634\u0648\u0631 \u062c\u062f\u064a\u062f",
      editPost: "\u062a\u0639\u062f\u064a\u0644 \u0627\u0644\u0645\u0646\u0634\u0648\u0631",
      titleLabel: "\u0627\u0644\u0639\u0646\u0648\u0627\u0646",
      summaryLabel: "\u0627\u0644\u0645\u0644\u062e\u0635",
      bodyLabel: "\u0627\u0644\u0645\u0642\u0627\u0644",
      titlePlaceholder: "\u0623\u0636\u0641 \u0639\u0646\u0648\u0627\u0646\u064b\u0627",
      summaryPlaceholder: "\u0623\u0636\u0641 \u0645\u0644\u062e\u0635\u064b\u0627 \u0642\u0635\u064a\u0631\u064b\u0627",
      bodyPlaceholder: "\u0627\u0628\u062f\u0623 \u0627\u0644\u0643\u062a\u0627\u0628\u0629",
      editTab: "\u062a\u062d\u0631\u064a\u0631",
      previewTab: "\u0645\u0639\u0627\u064a\u0646\u0629",
      unsavedChanges: "\u062a\u063a\u064a\u064a\u0631\u0627\u062a \u063a\u064a\u0631 \u0645\u062d\u0641\u0648\u0638\u0629",
      saveDraft: "\u062d\u0641\u0638 \u0643\u0645\u0633\u0648\u062f\u0629",
      saveAsDraft: "\u062d\u0641\u0638 \u0643\u0645\u0633\u0648\u062f\u0629",
      publish: "\u0646\u0634\u0631",
      updatePublished: "\u062a\u062d\u062f\u064a\u062b \u0627\u0644\u0645\u0646\u0634\u0648\u0631",
      unpublish: "\u0625\u0644\u063a\u0627\u0621 \u0627\u0644\u0646\u0634\u0631",
      delete: "\u062d\u0630\u0641",
      game: "\u0627\u0644\u0644\u0639\u0628\u0629",
      relatedGame: "\u0644\u0639\u0628\u0629 \u0630\u0627\u062a \u0635\u0644\u0629",
      relatedGameNone: "\u0628\u062f\u0648\u0646 \u0644\u0639\u0628\u0629",
      contentMode: "\u0648\u0636\u0639 \u0644\u063a\u0629 \u0627\u0644\u0645\u062d\u062a\u0648\u0649",
      shared: "\u0645\u0634\u062a\u0631\u0643",
      separate: "\u0645\u0646\u0641\u0635\u0644",
      sharedHint: "\u0627\u0644\u0645\u0646\u0634\u0648\u0631\u0627\u062a \u0627\u0644\u0645\u0634\u062a\u0631\u0643\u0629 \u062a\u0639\u0631\u0636 \u0627\u0644\u0646\u0635 \u0646\u0641\u0633\u0647 \u0628\u0644\u063a\u062a\u064a \u0627\u0644\u0645\u0648\u0642\u0639.",
      writingLanguage: "\u0644\u063a\u0629 \u0627\u0644\u0643\u062a\u0627\u0628\u0629",
      english: "English",
      arabic: "\u0627\u0644\u0639\u0631\u0628\u064a\u0629",
      status: "\u0627\u0644\u062d\u0627\u0644\u0629",
      published: "\u0645\u0646\u0634\u0648\u0631",
      draft: "\u0645\u0633\u0648\u062f\u0629",
      author: "\u0627\u0644\u0643\u0627\u062a\u0628",
      authors: "\u0627\u0644\u0643\u062a\u0651\u0627\u0628",
      authorsHint: "\u0627\u062e\u062a\u0631 \u0634\u062e\u0635\u064b\u0627 \u0623\u0648 \u0623\u0643\u062b\u0631 \u0644\u0646\u0633\u0628 \u0627\u0644\u0645\u0642\u0627\u0644 \u0625\u0644\u064a\u0647\u0645. \u062a\u0638\u0647\u0631 \u0627\u0644\u0635\u0648\u0631 \u0645\u0646 \u062a\u0633\u062c\u064a\u0644 \u062f\u062e\u0648\u0644\u0647\u0645 \u0644\u0644\u0648\u062d\u0629.",
      authorLoading: "\u062c\u0627\u0631\u064d \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0643\u062a\u0651\u0627\u0628\u2026",
      authorEmpty: "\u0644\u0627 \u064a\u0648\u062c\u062f \u0643\u062a\u0651\u0627\u0628 \u0645\u0624\u0647\u0644\u0648\u0646",
      livePreview: "\u0645\u0639\u0627\u064a\u0646\u0629 \u0645\u0628\u0627\u0634\u0631\u0629",
      previewEmpty: "\u0627\u0628\u062f\u0623 \u0627\u0644\u0643\u062a\u0627\u0628\u0629 \u0644\u0645\u0639\u0627\u064a\u0646\u0629 \u0627\u0644\u0645\u0646\u0634\u0648\u0631.",
      untitled: "\u0645\u0646\u0634\u0648\u0631 \u0628\u0644\u0627 \u0639\u0646\u0648\u0627\u0646",
      cover: "\u0635\u0648\u0631\u0629 \u0627\u0644\u063a\u0644\u0627\u0641",
      coverHint: "\u064a\u064f\u0646\u0635\u062d \u0628\u0646\u0633\u0628\u0629 5:2. \u0627\u0646\u0642\u0631 \u0644\u0644\u0631\u0641\u0639\u060c \u0623\u0648 \u0627\u0644\u0635\u0642 \u0623\u0648 \u0627\u0633\u062d\u0628 \u0635\u0648\u0631\u0629 \u0647\u0646\u0627.",
      coverEdit: "\u062a\u0639\u062f\u064a\u0644",
      coverReplace: "\u0627\u0633\u062a\u0628\u062f\u0627\u0644",
      coverRemove: "\u0625\u0632\u0627\u0644\u0629",
      coverPlacement: "\u0645\u0648\u0636\u0639 \u0627\u0644\u063a\u0644\u0627\u0641",
      placementTop: "\u0623\u0639\u0644\u0649 \u0627\u0644\u0645\u0642\u0627\u0644",
      placementBottom: "\u0623\u0633\u0641\u0644 \u0627\u0644\u0645\u0642\u0627\u0644",
      placementCardOnly: "\u0641\u064a \u0627\u0644\u0628\u0637\u0627\u0642\u0629 \u0641\u0642\u0637",
      ewcLabel: "\u0645\u062a\u0639\u0644\u0642 \u0628\u0643\u0623\u0633 \u0627\u0644\u0639\u0627\u0644\u0645",
      ewcHint: "\u0636\u0639 \u0639\u0644\u0627\u0645\u0629 \u0644\u0639\u0631\u0636 \u0647\u0630\u0627 \u0627\u0644\u0645\u0646\u0634\u0648\u0631 \u0623\u064a\u0636\u064b\u0627 \u0641\u064a \u0642\u0633\u0645 \u0623\u062e\u0628\u0627\u0631 EWC.",
      ewcYes: "EWC",
      ewcNo: "\u0639\u0627\u0645",
      uploadHint: "\u0627\u0644\u0635\u0642 \u0623\u0648 \u0627\u0633\u062d\u0628 \u0635\u0648\u0631\u0629\u060c \u0623\u0648 \u0627\u0646\u0642\u0631 \u0644\u0644\u0631\u0641\u0639.",
      dropToUpload: "\u0623\u0641\u0644\u062a \u0627\u0644\u0635\u0648\u0631\u0629 \u0644\u0631\u0641\u0639\u0647\u0627",
      uploading: "\u062c\u0627\u0631\u064d \u0627\u0644\u0631\u0641\u0639\u2026",
      wordCount: "\u0643\u0644\u0645\u0629",
      cropTitle: "\u0627\u0642\u062a\u0635\u0627\u0635 \u0627\u0644\u0635\u0648\u0631\u0629",
      cropDescription: "\u0627\u0633\u062d\u0628 \u0625\u0637\u0627\u0631 \u0627\u0644\u0627\u0642\u062a\u0635\u0627\u0635 \u0644\u062a\u062d\u0631\u064a\u0643\u0647\u060c \u0623\u0648 \u0627\u0633\u062d\u0628 \u0645\u0642\u0628\u0636\u064b\u0627 \u0644\u062a\u063a\u064a\u064a\u0631 \u0627\u0644\u062d\u062c\u0645.",
      cropZoom: "\u0627\u0644\u062a\u0643\u0628\u064a\u0631",
      cropAspect: "\u0646\u0633\u0628\u0629 \u0627\u0644\u0623\u0628\u0639\u0627\u062f",
      cropFree: "\u062d\u0631\u0651",
      cropFreeHint: "\u0627\u0644\u0648\u0636\u0639 \u0627\u0644\u062d\u0631\u0651: \u0627\u0633\u062d\u0628 \u0627\u0644\u0645\u0642\u0627\u0628\u0636 \u0644\u062a\u063a\u064a\u064a\u0631 \u0627\u0644\u0639\u0631\u0636 \u0648\u0627\u0644\u0627\u0631\u062a\u0641\u0627\u0639 \u0628\u0634\u0643\u0644 \u0645\u0633\u062a\u0642\u0644.",
      cropCancel: "\u0625\u0644\u063a\u0627\u0621",
      cropApply: "\u062a\u0637\u0628\u064a\u0642 \u0627\u0644\u0627\u0642\u062a\u0635\u0627\u0635",
      cropApplying: "\u062c\u0627\u0631\u064d \u0627\u0644\u062a\u0637\u0628\u064a\u0642\u2026",
      cropBeforeUpload: "\u0627\u0642\u062a\u0635\u0627\u0635 \u0647\u0630\u0647 \u0627\u0644\u0635\u0648\u0631\u0629\u061f",
      cropBeforeUploadBody:
        "\u0647\u0644 \u062a\u0631\u064a\u062f \u0627\u0642\u062a\u0635\u0627\u0635 \u0647\u0630\u0647 \u0627\u0644\u0635\u0648\u0631\u0629 \u0642\u0628\u0644 \u0625\u0636\u0627\u0641\u062a\u0647\u0627\u060c \u0623\u0645 \u0631\u0641\u0639\u0647\u0627 \u0643\u0645\u0627 \u0647\u064a\u061f",
      cropBeforeUploadCrop: "\u0627\u0642\u062a\u0635\u0627\u0635 \u0627\u0644\u0635\u0648\u0631\u0629",
      cropBeforeUploadAsIs: "\u0631\u0641\u0639 \u0643\u0645\u0627 \u0647\u064a",
      cropSkipNotice: "\u0627\u0644\u0635\u0648\u0631 \u0627\u0644\u0645\u062a\u062d\u0631\u0643\u0629 \u0648\u0635\u0648\u0631 AVIF \u062a\u064f\u0631\u0641\u0639 \u062f\u0648\u0646 \u0627\u0642\u062a\u0635\u0627\u0635.",
      confirmCancel: "\u0625\u0644\u063a\u0627\u0621",
      discardTitle: "\u0627\u0644\u062d\u0641\u0638 \u0641\u064a \u0627\u0644\u0648\u0636\u0639 \u0627\u0644\u0645\u0634\u062a\u0631\u0643\u061f",
      discardConfirmAction: "\u062d\u0641\u0638 \u0648\u062a\u062c\u0627\u0647\u0644",
      deleteTitle: "\u062d\u0630\u0641 \u0647\u0630\u0627 \u0627\u0644\u0645\u0646\u0634\u0648\u0631\u061f",
      deleteConfirmAction: "\u062d\u0630\u0641",
      publishRequiredShared: "\u0627\u0644\u0639\u0646\u0648\u0627\u0646 \u0648\u0627\u0644\u0645\u062d\u062a\u0648\u0649 \u0645\u0637\u0644\u0648\u0628\u0627\u0646 \u0642\u0628\u0644 \u0627\u0644\u0646\u0634\u0631.",
      publishRequiredTranslated:
        "\u0627\u0644\u0639\u0646\u0627\u0648\u064a\u0646 \u0648\u0627\u0644\u0645\u062d\u062a\u0648\u0649 \u0628\u0627\u0644\u0644\u063a\u062a\u064a\u0646 \u0627\u0644\u0625\u0646\u062c\u0644\u064a\u0632\u064a\u0629 \u0648\u0627\u0644\u0639\u0631\u0628\u064a\u0629 \u0645\u0637\u0644\u0648\u0628\u0629 \u0642\u0628\u0644 \u0627\u0644\u0646\u0634\u0631.",
      sharedDiscardConfirm:
        "\u0623\u0646\u062a \u062a\u062d\u0641\u0638 \u0641\u064a \u0627\u0644\u0648\u0636\u0639 \u0627\u0644\u0645\u0634\u062a\u0631\u0643. \u0645\u0633\u0648\u062f\u0629 \u0627\u0644\u0644\u063a\u0629 \u0627\u0644\u0623\u062e\u0631\u0649 \u0644\u0646 \u062a\u064f\u062d\u0641\u0638 \u0648\u0633\u064a\u064f\u062d\u0630\u0641 \u0645\u062d\u062a\u0648\u0627\u0647\u0627. \u0647\u0644 \u062a\u0631\u064a\u062f \u0627\u0644\u0645\u062a\u0627\u0628\u0639\u0629\u061f",
      deleteConfirm: "\u062d\u0630\u0641 \u0647\u0630\u0627 \u0627\u0644\u0645\u0646\u0634\u0648\u0631\u061f \u0644\u0627 \u064a\u0645\u0643\u0646 \u0627\u0644\u062a\u0631\u0627\u062c\u0639.",
      couldNotSave: "\u062a\u0639\u0630\u0651\u0631 \u0627\u0644\u062d\u0641\u0638",
      uploadFailed: "\u0641\u0634\u0644 \u0627\u0644\u0631\u0641\u0639",
      saveFailed: "\u0641\u0634\u0644 \u0627\u0644\u062d\u0641\u0638",
      deleteFailed: "\u0641\u0634\u0644 \u0627\u0644\u062d\u0630\u0641",
    },
    footer: {
      brand: "\u0628\u0648\u062a \u0645\u062c\u062a\u0645\u0639 \u0627\u0644\u0631\u064a\u0627\u0636\u0627\u062a \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a\u0629",
      note: "\u062a\u063a\u0637\u064a\u0629 \u0627\u0644\u0645\u062c\u062a\u0645\u0639\u060c \u0644\u0648\u062d\u0627\u062a \u0627\u0644\u062a\u0648\u0642\u0639\u0627\u062a\u060c \u0648\u0627\u0633\u062a\u0639\u0631\u0627\u0636 \u0645\u0644\u0641 \u062f\u064a\u0633\u0643\u0648\u0631\u062f.",
      explore: "\u062a\u0635\u0641\u0651\u062d",
      about: "\u0639\u0646 \u0627\u0644\u0645\u0646\u0635\u0629",
      contact: "\u062a\u0648\u0627\u0635\u0644 \u0645\u0639\u0646\u0627",
      contactHint: "\u0623\u0633\u0626\u0644\u0629 \u0623\u0648 \u0634\u0631\u0627\u0643\u0627\u062a\u061f \u062a\u0648\u0627\u0635\u0644 \u0645\u0639\u0646\u0627 \u0641\u064a \u0623\u064a \u0648\u0642\u062a.",
      emailUs: "\u0631\u0627\u0633\u0644\u0646\u0627 \u0628\u0627\u0644\u0628\u0631\u064a\u062f",
      madeIn: "\u0635\u064f\u0646\u0639 \u0628\u0641\u062e\u0631 \u0641\u064a \u0627\u0644\u0633\u0639\u0648\u062f\u064a\u0629",
      rights: "\u062c\u0645\u064a\u0639 \u0627\u0644\u062d\u0642\u0648\u0642 \u0645\u062d\u0641\u0648\u0638\u0629.",
    },
  },
} as const;

export const copy = {
  en: {
    ...baseCopy.en,
    leaderboard: {
      ...baseCopy.en.leaderboard,
      title: (season: string) => "EWC " + season + " prediction leaderboard",
      description: (total: number) => formatNumber(total, "en") + " ranked member" + (total === 1 ? "" : "s") + " this season",
      page: (page: number, pages: number) => "Page " + formatNumber(page, "en") + " of " + formatNumber(pages, "en"),
      showing: (start: number, end: number, total: number) =>
        "Showing " + formatNumber(start, "en") + "–" + formatNumber(end, "en") + " of " + formatNumber(total, "en"),
    },
    profile: {
      ...baseCopy.en.profile,
      top3Sweep: (count: number) => formatNumber(count, "en") + " top 3 sweep" + (count === 1 ? "" : "s"),
      scoredWeeks: (count: number) => formatNumber(count, "en") + " scored week" + (count === 1 ? "" : "s"),
    },
  },
  ar: {
    ...baseCopy.ar,
    leaderboard: {
      ...baseCopy.ar.leaderboard,
      title: (season: string) => "\u0644\u0648\u062d\u0629 \u062a\u0648\u0642\u0639\u0627\u062a EWC " + season,
      description: (total: number) => formatNumber(total, "ar") + " \u0639\u0636\u0648 \u0641\u064a \u0627\u0644\u062a\u0631\u062a\u064a\u0628 \u0647\u0630\u0627 \u0627\u0644\u0645\u0648\u0633\u0645",
      page: (page: number, pages: number) => "\u0635\u0641\u062d\u0629 " + formatNumber(page, "ar") + " \u0645\u0646 " + formatNumber(pages, "ar"),
      showing: (start: number, end: number, total: number) =>
        "\u0639\u0631\u0636 " + formatNumber(start, "ar") + "\u2013" + formatNumber(end, "ar") + " \u0645\u0646 " + formatNumber(total, "ar"),
    },
    profile: {
      ...baseCopy.ar.profile,
      top3Sweep: (count: number) => formatNumber(count, "ar") + " \u062a\u0648\u0642\u0639 \u0643\u0627\u0645\u0644 \u0644\u0644\u0645\u0631\u0627\u0643\u0632 \u0627\u0644\u062b\u0644\u0627\u062b\u0629",
      scoredWeeks: (count: number) => formatNumber(count, "ar") + " \u0623\u0633\u0627\u0628\u064a\u0639 \u0645\u062d\u0633\u0648\u0628\u0629",
    },
  },
} as const;
