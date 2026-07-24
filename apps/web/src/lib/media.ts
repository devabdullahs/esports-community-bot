import "server-only";

import {
  createEwcMediaChannel as _create,
  deleteEwcMediaChannel as _delete,
  getEwcMediaChannel as _get,
  listEwcMediaChannels as _list,
  reorderEwcMediaChannels as _reorder,
  updateEwcMediaChannel as _update,
} from "@bot/db/ewcMediaChannels.js";
import type { Locale } from "@/lib/i18n";
import { unstable_cache } from "next/cache";

export type LocalizedText = Record<Locale, string>;

export const MEDIA_PLATFORMS = [
  "x",
  "youtube",
  "tiktok",
  "instagram",
  "twitch",
  "website",
] as const;
export type MediaPlatform = (typeof MEDIA_PLATFORMS)[number];
export type MediaLink = { platform: MediaPlatform; url: string };

export type MediaChannelRecord = {
  slug: string;
  name: LocalizedText;
  description: LocalizedText;
  logoUrl: string | null;
  links: MediaLink[];
  discordChannelId: string | null;
  gameSlug: string | null;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
};

export type MediaChannelInput = {
  slug: string;
  name: LocalizedText;
  description: LocalizedText;
  logoUrl: string | null;
  links: MediaLink[];
  discordChannelId: string | null;
  gameSlug: string | null;
};

const list = _list as () => Promise<MediaChannelRecord[]>;
const get = _get as (slug: string) => Promise<MediaChannelRecord | null>;
const create = _create as unknown as (input: MediaChannelInput) => Promise<MediaChannelRecord>;
const update = _update as unknown as (
  slug: string,
  input: Omit<MediaChannelInput, "slug">,
) => Promise<MediaChannelRecord | null>;
export type MediaChannelDeleteResult =
  | { deleted: 0; conflict: "media_has_posts"; postCount: number }
  | { deleted: number; conflict: null; postCount: 0 };

const remove = _delete as (slug: string) => Promise<MediaChannelDeleteResult>;
const reorder = _reorder as (slugs: string[]) => Promise<MediaChannelRecord[]>;

export function listMediaChannels(): Promise<MediaChannelRecord[]> {
  return list();
}
export function getMediaChannel(slug: string): Promise<MediaChannelRecord | null> {
  return get(slug);
}
export function createMediaChannel(input: MediaChannelInput): Promise<MediaChannelRecord> {
  return create(input);
}
export function updateMediaChannel(
  slug: string,
  input: Omit<MediaChannelInput, "slug">,
): Promise<MediaChannelRecord | null> {
  return update(slug, input);
}
export function deleteMediaChannel(slug: string): Promise<MediaChannelDeleteResult> {
  return remove(slug);
}
export function reorderMediaChannels(slugs: string[]): Promise<MediaChannelRecord[]> {
  return reorder(slugs);
}

// ---------------------------------------------------------------------------
// Cached public-read variants (tags: cms-media)
// Admin pages keep using the uncached functions above.
// ---------------------------------------------------------------------------

export const listMediaChannelsCached = unstable_cache(
  async () => listMediaChannels(),
  ["media-list"],
  { tags: ["cms-media"] },
);

export const getMediaChannelCached = unstable_cache(
  async (slug: string) => getMediaChannel(slug),
  ["media-get"],
  { tags: ["cms-media"] },
);
