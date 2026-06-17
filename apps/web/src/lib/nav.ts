// Active-route matching for the site header nav. Pure + framework-free so it
// can be unit tested without a router. `href` is the already-localized pathname,
// and `pathname` comes from usePathname().
export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}
