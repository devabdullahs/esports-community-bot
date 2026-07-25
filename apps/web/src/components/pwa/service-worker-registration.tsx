"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const timeout = window.setTimeout(() => {
      void navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      }).catch(() => {
        // Offline support is progressive enhancement; normal navigation remains available.
      });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  return null;
}
