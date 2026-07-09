export type AdminNavigationIntent = {
  href: string;
  currentUrl: string;
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  download?: boolean;
  target?: string | null;
};

export function guardedAdminNavigationHref(intent: AdminNavigationIntent): string | null {
  if ((intent.button ?? 0) !== 0) return null;
  if (intent.metaKey || intent.ctrlKey || intent.shiftKey || intent.altKey) return null;
  if (intent.download) return null;

  const target = intent.target?.trim().toLowerCase() ?? "";
  if (target && target !== "_self") return null;

  let current: URL;
  let destination: URL;
  try {
    current = new URL(intent.currentUrl);
    destination = new URL(intent.href, current);
  } catch {
    return null;
  }

  if (destination.protocol !== "http:" && destination.protocol !== "https:") return null;
  if (destination.origin !== current.origin) return null;
  if (destination.pathname === current.pathname && destination.search === current.search) return null;

  return `${destination.pathname}${destination.search}${destination.hash}`;
}
