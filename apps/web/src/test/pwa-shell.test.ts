import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import manifest from "@/app/manifest";

type WorkerListener = (event: Record<string, unknown>) => void;

function loadWorker({
  fetchImpl = vi.fn(async () => new Response("online")),
  cacheMatch = vi.fn(async () => new Response("offline")),
} = {}) {
  const listeners = new Map<string, WorkerListener>();
  const showNotification = vi.fn(async () => undefined);
  const openWindow = vi.fn(async () => undefined);
  const worker = {
    location: { origin: "https://esportscommunity.net" },
    registration: { showNotification },
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => []),
      openWindow,
    },
    skipWaiting: vi.fn(async () => undefined),
    addEventListener: (type: string, listener: WorkerListener) => listeners.set(type, listener),
  };
  const caches = {
    open: vi.fn(async () => ({
      addAll: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
    })),
    keys: vi.fn(async () => []),
    delete: vi.fn(async () => true),
    match: cacheMatch,
  };
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "public/sw.js"),
    "utf8",
  );
  vm.runInNewContext(source, {
    self: worker,
    caches,
    fetch: fetchImpl,
    URL,
    Response,
    Promise,
  });
  return { listeners, worker, caches, fetchImpl, showNotification, openWindow };
}

describe("PWA manifest", () => {
  it("defines a standalone app with loadable install icons", () => {
    const value = manifest();
    expect(value).toMatchObject({
      id: "/",
      start_url: "/",
      scope: "/",
      display: "standalone",
      theme_color: "#0b0e14",
    });
    expect(value.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: "/icons/app-192.png", sizes: "192x192" }),
      expect.objectContaining({ src: "/icons/app-512.png", sizes: "512x512" }),
    ]));
  });
});

describe("PWA service worker", () => {
  it.each([
    "/admin",
    "/admin/news/1",
    "/ar/admin",
    "/me",
    "/ar/me",
    "/login",
    "/api/me/notifications",
    "/api/mcp",
    "/api/public-mcp",
  ])("never intercepts private navigation %s", (pathname) => {
    const { listeners, fetchImpl } = loadWorker();
    const respondWith = vi.fn();

    listeners.get("fetch")?.({
      request: {
        method: "GET",
        mode: "navigate",
        url: `https://esportscommunity.net${pathname}`,
      },
      respondWith,
    });

    expect(respondWith).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("falls back to the matching localized offline shell for public navigation", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    const cacheMatch = vi.fn(async (key: string) => new Response(key));
    const { listeners } = loadWorker({ fetchImpl, cacheMatch });
    let responsePromise: Promise<Response> | null = null;

    listeners.get("fetch")?.({
      request: {
        method: "GET",
        mode: "navigate",
        url: "https://esportscommunity.net/ar/tournaments",
      },
      respondWith: (value: Promise<Response>) => {
        responsePromise = value;
      },
    });

    expect(await (responsePromise as unknown as Promise<Response>).then((response) => response.text())).toBe("/ar/offline");
    expect(cacheMatch).toHaveBeenCalledWith("/ar/offline");
  });

  it("forces push notification targets onto the website origin", async () => {
    const { listeners, showNotification } = loadWorker();
    let work: Promise<unknown> | null = null;

    listeners.get("push")?.({
      data: {
        json: () => ({
          title: "Match started",
          body: "Team A vs Team B",
          url: "https://example.com/account",
        }),
      },
      waitUntil: (value: Promise<unknown>) => {
        work = value;
      },
    });
    await work;

    expect(showNotification).toHaveBeenCalledWith(
      "Match started",
      expect.objectContaining({
        data: expect.objectContaining({ url: "https://esportscommunity.net/" }),
      }),
    );
  });
});
