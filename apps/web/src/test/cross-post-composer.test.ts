import { describe, expect, test } from "vitest";
import {
  buildNewsCrossPostPreview,
  buildNewsDiscordAnnouncementPreview,
  getNewsCrossPostWebsiteState,
} from "@bot/lib/newsCrossPost.js";

const basePost = {
  id: 124,
  defaultLocale: "en",
  status: "draft",
  translations: {
    en: { locale: "en", title: "Game update", summary: "A game summary", body: "Full game body" },
    ar: { locale: "ar", title: "Arabic update", summary: "Arabic summary", body: "Arabic body" },
  },
};

describe("cross-post composer model", () => {
  test("prepares a game draft with canonical, Discord, and X URLs without sending a request", () => {
    const preview = buildNewsCrossPostPreview(
      { ...basePost, gameSlug: "valorant", mediaSlug: null },
      { baseUrl: "https://esportscommunity.net", preferredLocale: "en", hashtags: "EWC, Valorant" },
    );

    expect(getNewsCrossPostWebsiteState({ ...basePost, gameSlug: "valorant" })).toBe("draft");
    expect(preview.canonicalUrl).toBe("https://esportscommunity.net/games/valorant/news/124");
    expect(preview.discordUrl).toContain("utm_source=discord");
    expect(preview.xIntentUrl).toContain("twitter.com/intent/tweet");
    expect(preview.socialText).toContain("#EWC #Valorant");
  });

  test("prepares a scheduled media post with the media canonical path and Arabic Discord content", () => {
    const post = { ...basePost, gameSlug: null, mediaSlug: "echo", status: "scheduled" as const };
    const preview = buildNewsCrossPostPreview(post, {
      baseUrl: "https://esportscommunity.net",
      preferredLocale: "ar",
    });
    const discord = buildNewsDiscordAnnouncementPreview(post, {
      baseUrl: "https://esportscommunity.net",
    });

    expect(getNewsCrossPostWebsiteState(post)).toBe("scheduled");
    expect(preview.canonicalUrl).toBe("https://esportscommunity.net/ar/media/echo/news/124");
    expect(discord.title).toBe("Arabic update");
    expect(discord.url).toContain("utm_campaign=news_announcement");
  });

  test("distinguishes published posts from new, unsaved composer content", () => {
    expect(getNewsCrossPostWebsiteState({ ...basePost, status: "published" })).toBe("published");
    expect(getNewsCrossPostWebsiteState({ status: "draft" })).toBe("unsaved");
  });
});
