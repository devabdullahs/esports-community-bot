import "server-only";

import { after } from "next/server";
import { dashboardPublicUrl } from "@/lib/env";
import type { NewsPost } from "@/lib/news";
import { newsPublicPaths } from "@/lib/news-url";

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;
const INDEXNOW_VISIBILITY_DELAY_MS = 65_000;

export function indexNowKey() {
  if (process.env.EWC_INDEXNOW_ENABLED !== "true") return null;
  const key = process.env.EWC_INDEXNOW_KEY?.trim() || "";
  return KEY_PATTERN.test(key) ? key : null;
}

export function indexNowUrlsForPost(post: NewsPost | null | undefined) {
  if (!post || post.status !== "published") return [];
  const base = new URL(dashboardPublicUrl());
  return newsPublicPaths(post).map((path) => new URL(path, base).toString());
}

export async function submitIndexNowUrls(input: Iterable<string>) {
  const key = indexNowKey();
  if (!key) return;

  const site = new URL(dashboardPublicUrl());
  if (site.protocol !== "https:" && site.hostname !== "localhost") return;

  const urls = [...new Set(input)]
    .map((value) => {
      try {
        return new URL(value, site);
      } catch {
        return null;
      }
    })
    .filter((value): value is URL => Boolean(value && value.origin === site.origin))
    .slice(0, 100)
    .map((value) => value.toString());
  if (urls.length === 0) return;

  try {
    const response = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        host: site.host,
        key,
        keyLocation: new URL(`/indexnow/${key}.txt`, site).toString(),
        urlList: urls,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      console.warn(`IndexNow submission failed with status ${response.status}`);
    }
  } catch (error) {
    console.warn("IndexNow submission failed", error instanceof Error ? error.message : "unknown");
  }
}

export function scheduleIndexNowUrls(input: Iterable<string>) {
  if (!indexNowKey()) return;
  const urls = [...input];
  const task = async () => {
    await new Promise((resolve) => setTimeout(resolve, INDEXNOW_VISIBILITY_DELAY_MS));
    await submitIndexNowUrls(urls);
  };
  try {
    after(task);
  } catch {
    // Direct route-unit calls do not create a Next request context. Production
    // requests take the `after` path; this fallback preserves non-blocking,
    // best-effort behavior in scripts and tests.
    void task();
  }
}
