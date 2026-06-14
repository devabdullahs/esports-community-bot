import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/metadata";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Admin surface, API routes, and per-user/auth pages are not for crawlers.
      disallow: ["/admin", "/api/", "/me", "/login"],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
