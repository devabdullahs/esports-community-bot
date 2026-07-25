const CACHE_VERSION = "ecb-pwa-v1";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const OFFLINE_EN = "/offline";
const OFFLINE_AR = "/ar/offline";
const SHELL_URLS = [
  OFFLINE_EN,
  OFFLINE_AR,
  "/icon.svg",
  "/apple-icon.png",
  "/icons/app-192.png",
  "/icons/app-512.png",
];
const PRIVATE_PATH_PREFIXES = [
  "/admin",
  "/me",
  "/login",
  "/api",
  "/auth",
];

function isPathUnder(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isPrivatePath(pathname) {
  const cleanPath = pathname === "/ar" || pathname.startsWith("/ar/")
    ? pathname.slice(3) || "/"
    : pathname;
  return PRIVATE_PATH_PREFIXES.some((prefix) => isPathUnder(cleanPath, prefix));
}

function isCacheableStaticPath(pathname) {
  return pathname.startsWith("/_next/static/")
    || pathname.startsWith("/icons/")
    || pathname === "/icon.svg"
    || pathname === "/apple-icon.png";
}

function safeNotificationUrl(value) {
  try {
    const url = new URL(typeof value === "string" ? value : "/", self.location.origin);
    return url.origin === self.location.origin ? url.href : `${self.location.origin}/`;
  } catch {
    return `${self.location.origin}/`;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith("ecb-pwa-") && ![SHELL_CACHE, STATIC_CACHE].includes(key))
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isPrivatePath(url.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(
        url.pathname === "/ar" || url.pathname.startsWith("/ar/") ? OFFLINE_AR : OFFLINE_EN,
      )),
    );
    return;
  }

  if (!isCacheableStaticPath(url.pathname)) return;
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok && response.type === "basic") {
        void caches.open(STATIC_CACHE).then((cache) => cache.put(request, response.clone()));
      }
      return response;
    })),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() || "" };
  }

  const title = typeof payload.title === "string" && payload.title.trim()
    ? payload.title.trim().slice(0, 180)
    : "Esports Community";
  const options = {
    body: typeof payload.body === "string" ? payload.body.slice(0, 500) : "",
    icon: "/icons/app-192.png",
    badge: "/icons/app-192.png",
    tag: typeof payload.tag === "string" ? payload.tag.slice(0, 180) : undefined,
    data: {
      url: safeNotificationUrl(payload.url),
      notificationId: typeof payload.notificationId === "string"
        ? payload.notificationId.slice(0, 80)
        : null,
    },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = safeNotificationUrl(event.notification.data?.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const exact = windows.find((client) => client.url === targetUrl);
    if (exact) return exact.focus();

    const sameOrigin = windows.find((client) => {
      try {
        return new URL(client.url).origin === self.location.origin;
      } catch {
        return false;
      }
    });
    if (sameOrigin) {
      try {
        await sameOrigin.navigate(targetUrl);
        return sameOrigin.focus();
      } catch {
        // Fall through to opening a fresh same-origin window.
      }
    }
    return self.clients.openWindow(targetUrl);
  })());
});
