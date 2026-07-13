const SAFE_CAMPAIGN = /^[A-Za-z0-9_-]{1,64}$/;

export function trackedShareUrl(
  value: string,
  source: "x" | "discord",
  campaign = "news_share",
) {
  const url = new URL(value);
  url.searchParams.set("utm_source", source);
  url.searchParams.set("utm_medium", source === "x" ? "social" : "community");
  url.searchParams.set("utm_campaign", SAFE_CAMPAIGN.test(campaign) ? campaign : "news_share");
  return url.toString();
}
