import "server-only";

import { Buffer } from "node:buffer";
import { renderEwcShareCard } from "@bot/lib/ewcShareCard.js";
import { getEwcMePayload } from "@/lib/ewc-profile-sync";
import { approvedDiscordAvatarUrl, normalizePublicDisplayName } from "@/lib/public-identity";
import type { Locale } from "@/lib/i18n";

const MAX_AVATAR_BYTES = 1_000_000;

export const SHARE_CARD_VARIANTS = ["prediction"] as const;
export type ShareCardVariant = (typeof SHARE_CARD_VARIANTS)[number];

type EwcShareCardInput = {
  displayName: string;
  avatar: Buffer | null;
  seasonPicks: string[];
  weeklyCount: number;
  season: string;
  locale: Locale;
};

const renderEwcShareCardForWeb = renderEwcShareCard as (input: EwcShareCardInput) => Promise<Buffer>;

export function parseShareCardVariant(value: string | null): ShareCardVariant | null {
  return value === "prediction" ? value : null;
}

export class ShareCardProfileRequiredError extends Error {
  constructor() {
    super("A prediction profile is required to create a share card.");
  }
}

async function trustedAvatarBuffer(value: string | null | undefined): Promise<Buffer | null> {
  const source = approvedDiscordAvatarUrl(value);
  if (!source) return null;

  try {
    const upstream = await fetch(source, {
      redirect: "error",
      cache: "no-store",
      headers: { Accept: "image/*" },
    });
    const contentType = upstream.headers.get("content-type") || "";
    const contentLengthHeader = upstream.headers.get("content-length");
    const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
    if (
      !upstream.ok ||
      !contentType.startsWith("image/") ||
      (contentLength !== null && Number.isFinite(contentLength) && (contentLength < 1 || contentLength > MAX_AVATAR_BYTES))
    ) {
      return null;
    }

    const bytes = Buffer.from(await upstream.arrayBuffer());
    return bytes.byteLength <= MAX_AVATAR_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

export async function renderShareCardForViewer({
  authUserId,
  displayName,
  avatarUrl,
  variant,
  locale,
}: {
  authUserId: string;
  displayName: string | null | undefined;
  avatarUrl: string | null | undefined;
  variant: ShareCardVariant;
  locale: Locale;
}): Promise<Buffer> {
  const payload = await getEwcMePayload({ authUserId });
  if (!payload.stats) throw new ShareCardProfileRequiredError();

  // The card renderer only receives identity from the server session and picks
  // from the authenticated profile projection; query parameters never shape it.
  const avatar = await trustedAvatarBuffer(avatarUrl);
  switch (variant) {
    case "prediction":
      return renderEwcShareCardForWeb({
        displayName: normalizePublicDisplayName(displayName) || "EWC Predictor",
        avatar,
        seasonPicks: payload.stats.seasonPicks,
        weeklyCount: payload.stats.weeksPredicted,
        season: payload.stats.season,
        locale,
      });
  }
}
