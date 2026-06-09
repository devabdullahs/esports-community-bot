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
  sortOrder: number;
};

export type MediaChannelInput = {
  slug: string;
  name: LocalizedText;
  description: LocalizedText;
  logoUrl: string | null;
  links: MediaLink[];
};

const list = _list as () => MediaChannelRecord[];
const get = _get as (slug: string) => MediaChannelRecord | null;
const create = _create as unknown as (input: MediaChannelInput) => MediaChannelRecord;
const update = _update as unknown as (
  slug: string,
  input: Omit<MediaChannelInput, "slug">,
) => MediaChannelRecord | null;
const remove = _delete as (slug: string) => { deleted: number };
const reorder = _reorder as (slugs: string[]) => MediaChannelRecord[];

export function listMediaChannels(): MediaChannelRecord[] {
  return list();
}
export function getMediaChannel(slug: string): MediaChannelRecord | null {
  return get(slug);
}
export function createMediaChannel(input: MediaChannelInput): MediaChannelRecord {
  return create(input);
}
export function updateMediaChannel(
  slug: string,
  input: Omit<MediaChannelInput, "slug">,
): MediaChannelRecord | null {
  return update(slug, input);
}
export function deleteMediaChannel(slug: string): { deleted: number } {
  return remove(slug);
}
export function reorderMediaChannels(slugs: string[]): MediaChannelRecord[] {
  return reorder(slugs);
}
