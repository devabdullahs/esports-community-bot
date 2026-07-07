import { localizedPath, stripLocalePrefix, type Locale } from "@/lib/i18n";

export type ProfileReturnType = "tournament" | "team" | "player";

export type ProfileReturnContext = {
  type: ProfileReturnType;
  href: string;
  label: string;
};

type SearchValue = string | string[] | undefined;

function first(value: SearchValue) {
  return Array.isArray(value) ? value[0] : value;
}

function cleanLabel(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
}

function cleanInternalPath(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 300 || !raw.startsWith("/") || raw.startsWith("//")) return null;
  if (raw.includes("\n") || raw.includes("\r")) return null;
  const stripped = stripLocalePrefix(raw);
  if (stripped.startsWith("/api/") || stripped === "/api") return null;
  return stripped;
}

export function profileReturnSearchParams(context: ProfileReturnContext) {
  const params = new URLSearchParams();
  const href = cleanInternalPath(context.href);
  const label = cleanLabel(context.label);
  if (!href || !label) return params;
  params.set("fromType", context.type);
  params.set("fromHref", href);
  params.set("fromLabel", label);
  return params;
}

export function withProfileReturn(
  pathname: string,
  locale: Locale,
  context: ProfileReturnContext | null | undefined,
) {
  const href = localizedPath(pathname, locale);
  if (!context) return href;
  const params = profileReturnSearchParams(context);
  const query = params.toString();
  if (!query) return href;
  return `${href}${href.includes("?") ? "&" : "?"}${query}`;
}

export function profileReturnContextFromSearchParams(
  searchParams: Record<string, SearchValue> | null | undefined,
  { currentPath }: { currentPath?: string } = {},
): ProfileReturnContext | null {
  const type = first(searchParams?.fromType);
  if (type !== "tournament" && type !== "team" && type !== "player") return null;
  const href = cleanInternalPath(first(searchParams?.fromHref));
  const label = cleanLabel(first(searchParams?.fromLabel));
  if (!href || !label) return null;
  const current = cleanInternalPath(currentPath);
  if (current && href === current) return null;
  return { type, href, label };
}
