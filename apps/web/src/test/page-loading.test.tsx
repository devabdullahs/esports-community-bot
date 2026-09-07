// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PageLoading } from "@/components/page-loading";

const state = vi.hoisted(() => ({ pathname: "/live" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test.each(["/live", "/ar/live"])("offers recovery only after a prolonged wait on %s", async (pathname) => {
  state.pathname = pathname;
  await act(async () => root.render(<PageLoading />));
  expect(container.querySelector("h1")?.textContent).toBe(pathname.startsWith("/ar") ? "جارٍ تحميل الصفحة" : "Loading your page");
  expect(container.querySelector("button")).toBeNull();
  expect(container.querySelector('[role="status"]')?.textContent).toBe("");
  await act(async () => vi.advanceTimersByTime(10_000));
  expect(container.querySelector("button")?.textContent).toContain(pathname.startsWith("/ar") ? "إعادة تحميل" : "Reload page");
  expect(container.querySelector('[role="status"]')?.textContent).not.toBe("");
});

test("clears the recovery timer when navigation finishes", async () => {
  await act(async () => root.render(<PageLoading />));
  await act(async () => root.render(null));
  expect(vi.getTimerCount()).toBe(0);
});
