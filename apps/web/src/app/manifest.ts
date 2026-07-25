import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Esports Community",
    short_name: "EC",
    description: "Follow esports tournaments, live matches, news, co-streams, and EWC predictions.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0b0e14",
    theme_color: "#0b0e14",
    lang: "en",
    dir: "auto",
    categories: ["sports", "news", "entertainment"],
    icons: [
      {
        src: "/icons/app-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/app-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
