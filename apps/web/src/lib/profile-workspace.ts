export const PROFILE_TABS = [
  "overview",
  "predictions",
  "following",
  "notifications",
  "settings",
] as const;

export type ProfileTab = (typeof PROFILE_TABS)[number];

export function normalizeProfileTab(value: string | null | undefined): ProfileTab {
  return PROFILE_TABS.includes(value as ProfileTab) ? (value as ProfileTab) : "overview";
}

export function profileTabHref(
  pathname: string,
  search: URLSearchParams | string,
  tab: ProfileTab,
) {
  const params = new URLSearchParams(search);
  params.set("tab", tab);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
