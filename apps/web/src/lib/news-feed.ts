import "server-only";

import { absoluteUrl, siteDescription, siteName } from "@/lib/metadata";
import { listPublishedNewsPostsForDiscoveryCached, type NewsPost } from "@/lib/news";
import { newsAvailableLocales, newsPublicPath } from "@/lib/news-url";
import { parseDateTime, type Locale } from "@/lib/i18n";

function xml(value: unknown) {
  const validXml = Array.from(String(value ?? ""))
    .filter((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point === 0x9 || point === 0xa || point === 0xd ||
        (point >= 0x20 && point <= 0xd7ff) ||
        (point >= 0xe000 && point <= 0xfffd) ||
        (point >= 0x10000 && point <= 0x10ffff);
    })
    .join("");
  return validXml
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function plainText(value: string) {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function translation(post: NewsPost, locale: Locale) {
  return post.translations[locale];
}

export async function newsRss(locale: Locale) {
  const posts = (await listPublishedNewsPostsForDiscoveryCached())
    .filter((post) => newsAvailableLocales(post).includes(locale))
    .slice(0, 100);
  const feedUrl = absoluteUrl(locale === "ar" ? "/feed-ar.xml" : "/feed.xml");
  const home = absoluteUrl(locale === "ar" ? "/ar" : "/");
  const items = posts.map((post) => {
    const content = translation(post, locale);
    const url = absoluteUrl(newsPublicPath(post, locale));
    const published = parseDateTime(post.publishedAt || post.createdAt);
    const description = plainText(content?.summary || content?.body || "").slice(0, 500);
    return [
      "<item>",
      `<title>${xml(content?.title)}</title>`,
      `<link>${xml(url)}</link>`,
      `<guid isPermaLink="false">${xml(`urn:esports-community:news:${post.id}:${locale}`)}</guid>`,
      Number.isNaN(published.getTime()) ? "" : `<pubDate>${published.toUTCString()}</pubDate>`,
      `<description>${xml(description)}</description>`,
      "</item>",
    ].join("");
  }).join("");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "<channel>",
    `<title>${xml(siteName(locale))}</title>`,
    `<link>${xml(home)}</link>`,
    `<description>${xml(siteDescription(locale))}</description>`,
    `<language>${locale === "ar" ? "ar-SA" : "en"}</language>`,
    `<atom:link href="${xml(feedUrl)}" rel="self" type="application/rss+xml"/>`,
    items,
    "</channel>",
    "</rss>",
  ].join("");
}

export async function newsFeedResponse(locale: Locale) {
  return new Response(await newsRss(locale), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=300, must-revalidate",
    },
  });
}
