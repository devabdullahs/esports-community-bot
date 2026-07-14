import { afterEach, describe, expect, test, vi } from "vitest";
import {
  PRODUCT_ANALYTICS_EVENT,
  PRODUCT_EVENT_NAMES,
  isProductEventName,
  trackProductEvent,
  type ProductEventName,
} from "@/lib/product-analytics";
import { markProductEventTokenSeen } from "@/components/analytics/analytics-tracker";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("closed product analytics contract", () => {
  test.each(PRODUCT_EVENT_NAMES)("accepts the allowlisted event %s", (eventName) => {
    expect(isProductEventName(eventName)).toBe(true);
  });

  test.each([
    "",
    "prediction_submit;drop table",
    "prediction_submit\nsource_link_open",
    "custom_event",
    "follow_create?team=private",
  ])("rejects unknown or injected event names", (eventName) => {
    expect(isProductEventName(eventName)).toBe(false);
  });

  test("dispatches an allowlisted same-window event with an opaque browser-only token", () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class {
        type: string;
        detail: unknown;

        constructor(type: string, init: { detail: unknown }) {
          this.type = type;
          this.detail = init.detail;
        }
      },
    );

    trackProductEvent("prediction_submit");

    expect(dispatchEvent).toHaveBeenCalledOnce();
    const event = dispatchEvent.mock.calls[0]?.[0] as {
      type: string;
      detail: { name: ProductEventName; token: unknown };
    };
    expect(event.type).toBe(PRODUCT_ANALYTICS_EVENT);
    expect(event.detail.name).toBe("prediction_submit");
    expect(typeof event.detail.token).toBe("symbol");
  });

  test("does not dispatch an invalid runtime value", () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });

    trackProductEvent("unbounded_event" as ProductEventName);

    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  test("forwards one observed dispatch token once and bounds the in-memory dedupe set", () => {
    const seen = new Set<symbol>();
    const order: symbol[] = [];
    const first = Symbol("first");
    const second = Symbol("second");
    const third = Symbol("third");

    expect(markProductEventTokenSeen(seen, order, first, 2)).toBe(true);
    expect(markProductEventTokenSeen(seen, order, first, 2)).toBe(false);
    expect(markProductEventTokenSeen(seen, order, second, 2)).toBe(true);
    expect(markProductEventTokenSeen(seen, order, third, 2)).toBe(true);
    expect(order).toEqual([second, third]);
    expect(seen.has(first)).toBe(false);
  });
});
