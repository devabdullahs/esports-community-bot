// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PushNotificationSettings } from "@/components/follows/push-notification-settings";

type ServiceWorkerMock = {
  getRegistration: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
  ready: Promise<unknown>;
};

let container: HTMLDivElement;
let root: Root;

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installPushGlobals({
  permission = "default",
  requestPermission = vi.fn(async () => "granted"),
  serviceWorker,
}: {
  permission?: NotificationPermission;
  requestPermission?: ReturnType<typeof vi.fn>;
  serviceWorker: ServiceWorkerMock;
}) {
  vi.stubGlobal("PushManager", class PushManager {});
  vi.stubGlobal("Notification", { permission, requestPermission });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: serviceWorker,
  });
}

async function renderSettings() {
  await act(async () => {
    root.render(<PushNotificationSettings locale="en" />);
  });
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function clickButton(label: string) {
  const button = [...container.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.includes(label));
  expect(button).toBeTruthy();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("PushNotificationSettings", () => {
  it("shows an unsupported state without requesting permission", async () => {
    Reflect.deleteProperty(window, "PushManager");
    Reflect.deleteProperty(window, "Notification");
    Reflect.deleteProperty(navigator, "serviceWorker");

    await renderSettings();

    expect(container.textContent).toContain("Not supported");
    expect(container.textContent).not.toContain("Enable on this device");
  });

  it("shows a useful disabled state when browser permission is denied", async () => {
    const requestPermission = vi.fn();
    installPushGlobals({
      permission: "denied",
      requestPermission,
      serviceWorker: {
        getRegistration: vi.fn(),
        register: vi.fn(),
        ready: Promise.resolve(null),
      },
    });

    await renderSettings();

    expect(container.textContent).toContain("Blocked by browser");
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("subscribes only after the user explicitly enables this device", async () => {
    const requestPermission = vi.fn(async () => "granted");
    const subscription = {
      endpoint: "https://push.example/subscription",
      toJSON: () => ({
        endpoint: "https://push.example/subscription",
        expirationTime: null,
        keys: { p256dh: "a".repeat(24), auth: "b".repeat(24) },
      }),
    };
    const getSubscription = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const subscribe = vi.fn(async () => subscription);
    const registration = { pushManager: { getSubscription, subscribe } };
    const serviceWorker = {
      getRegistration: vi.fn(async () => registration),
      register: vi.fn(async () => registration),
      ready: Promise.resolve(registration),
    };
    installPushGlobals({ requestPermission, serviceWorker });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return jsonResponse({
          subscription: {
            id: "52d83bf0-6c52-4e43-834c-0796b178f670",
            created_at: "2026-07-25T00:00:00.000Z",
            updated_at: "2026-07-25T00:00:00.000Z",
          },
        }, 201);
      }
      const subscribed = fetchMock.mock.calls.some((call) => call[1]?.method === "POST");
      return jsonResponse({
        enabled: true,
        publicKey: "AQ".repeat(44),
        subscriptions: subscribed ? [{
          id: "52d83bf0-6c52-4e43-834c-0796b178f670",
          created_at: "2026-07-25T00:00:00.000Z",
          updated_at: "2026-07-25T00:00:00.000Z",
        }] : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await renderSettings();
    expect(requestPermission).not.toHaveBeenCalled();

    await clickButton("Enable on this device");

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(serviceWorker.register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/me/push-subscriptions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(container.textContent).toContain("Active");
  });

  it("revokes only the current browser endpoint when disabled", async () => {
    const unsubscribe = vi.fn(async () => true);
    const subscription = {
      endpoint: "https://push.example/current-browser",
      unsubscribe,
    };
    const registration = {
      pushManager: {
        getSubscription: vi.fn(async () => subscription),
        subscribe: vi.fn(),
      },
    };
    installPushGlobals({
      permission: "granted",
      serviceWorker: {
        getRegistration: vi.fn(async () => registration),
        register: vi.fn(),
        ready: Promise.resolve(registration),
      },
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") return jsonResponse({ ok: true });
      const revoked = fetchMock.mock.calls.some((call) => call[1]?.method === "DELETE");
      return jsonResponse({
        enabled: true,
        publicKey: "AQ".repeat(44),
        subscriptions: revoked ? [] : [{
          id: "52d83bf0-6c52-4e43-834c-0796b178f670",
          created_at: "2026-07-25T00:00:00.000Z",
          updated_at: "2026-07-25T00:00:00.000Z",
        }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await renderSettings();
    expect(container.textContent).toContain("Active");

    await clickButton("Disable on this device");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/me/push-subscriptions",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      }),
    );
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Off");
  });
});
