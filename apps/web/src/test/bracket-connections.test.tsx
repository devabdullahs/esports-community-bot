// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { BracketConnections } from "@/components/tournaments/bracket-connections";

const roots: ReturnType<typeof createRoot>[] = [];
function render(node: ReactNode) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(node));
  return { container, unmount: () => act(() => root.unmount()) };
}
afterEach(() => { for (const root of roots.splice(0)) act(() => root.unmount()); document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test.each([false, true])("connections meet the real team port after resize, RTL=%s", async (rtl) => {
  let resize = () => {};
  let targetTop = 140;
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect = disconnect; });
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { callback(); return 1; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(window, "getComputedStyle").mockReturnValue({ direction: rtl ? "rtl" : "ltr" } as CSSStyleDeclaration);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const name = this.dataset.bracketSlot;
    const left = name === "source" ? (rtl ? 300 : 0) : (rtl ? 0 : 300);
    if (this.dataset.bracketSide) return { left, right: left + 252, top: targetTop, bottom: targetTop + 32 } as DOMRect;
    if (name) return { left, right: left + 252, top: 60, bottom: 140 } as DOMRect;
    return { left: 0, top: 0 } as DOMRect;
  });
  const { container, unmount } = render(<BracketConnections edges={[{ from: "source", to: "target", side: "b", outcome: "winner", kind: "declared" }]}>
    <div data-bracket-branch="upper"><div data-bracket-slot="source" /><div data-bracket-slot="target"><span data-bracket-side="b" /></div></div>
  </BracketConnections>);
  const path = () => container.querySelector("path");
  expect(path()?.getAttribute("d")).toBe(rtl ? "M 300 100 H 276 V 156 H 252" : "M 252 100 H 276 V 156 H 300");
  targetTop = 180;
  act(() => resize());
  expect(path()?.getAttribute("d")).toContain("V 196");
  unmount();
  expect(disconnect).toHaveBeenCalled();
});

test("missing endpoints never produce a fabricated connection", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { callback(); return 1; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const { container } = render(<BracketConnections edges={[{ from: "missing", to: "target", side: "a", outcome: "loser", kind: "declared" }]}><div /></BracketConnections>);
  expect(container.querySelectorAll("path")).toHaveLength(0);
});

test("a lower-bracket drop uses the gap between bands and a dashed path", () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { callback(); return 1; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.dataset.bracketBranch === "upper") return { top: 50, bottom: 200 } as DOMRect;
    if (this.dataset.bracketBranch === "lower") return { top: 400, bottom: 600 } as DOMRect;
    if (this.dataset.bracketSlot === "source") return { left: 0, right: 252, top: 60, bottom: 140 } as DOMRect;
    if (this.dataset.bracketSlot === "target") return { left: 300, right: 552, top: 400, bottom: 480 } as DOMRect;
    if (this.dataset.bracketSide) return { top: 400, bottom: 432 } as DOMRect;
    return { left: 0, top: 0 } as DOMRect;
  });
  const { container } = render(<BracketConnections edges={[{ from: "source", to: "target", side: "a", outcome: "loser", kind: "declared" }]}>
    <div data-bracket-branch="upper"><div data-bracket-slot="source" /></div>
    <div data-bracket-branch="lower"><div data-bracket-slot="target"><span data-bracket-side="a" /></div></div>
  </BracketConnections>);
  const path = container.querySelector("path");
  expect(path?.getAttribute("stroke-dasharray")).toBe("4 4");
  expect(path?.getAttribute("d")).toBe("M 252 100 H 264 V 295 H 288 V 416 H 300");
});
