export const PRODUCT_EVENT_NAMES = [
  "prediction_submit",
  "follow_create",
  "follow_remove",
  "notification_prefs_update",
  "multiview_start",
  "multiview_share",
  "site_search_result_open",
  "source_link_open",
  "discord_join_click",
] as const;

export type ProductEventName = (typeof PRODUCT_EVENT_NAMES)[number];

export const PRODUCT_ANALYTICS_EVENT = "ec-product-analytics";

type ProductEventDispatch = {
  name: ProductEventName;
  token: symbol;
};

export function isProductEventName(value: unknown): value is ProductEventName {
  return typeof value === "string" && (PRODUCT_EVENT_NAMES as readonly string[]).includes(value);
}

export function productEventDispatchFromEvent(event: Event): ProductEventDispatch | null {
  const detail = (event as CustomEvent<unknown>).detail;
  if (!detail || typeof detail !== "object") return null;
  const candidate = detail as { name?: unknown; token?: unknown };
  if (!isProductEventName(candidate.name) || typeof candidate.token !== "symbol") return null;
  return { name: candidate.name, token: candidate.token };
}

// Product events deliberately have no properties argument. The token only
// deduplicates this browser-window dispatch and is never sent beyond it.
export function trackProductEvent(name: ProductEventName) {
  if (typeof window === "undefined" || !isProductEventName(name)) return;
  window.dispatchEvent(
    new CustomEvent(PRODUCT_ANALYTICS_EVENT, {
      detail: { name, token: Symbol("ec-product-event") },
    }),
  );
}
