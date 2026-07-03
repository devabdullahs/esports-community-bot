import { normalizeSlug } from "@/lib/game-validation";
import { isSafeUrl } from "@/lib/safe-url";

export const PARTNER_INTERESTS = [
  "open_source_partner",
  "prediction_partner",
  "event_prize_later",
  "other",
] as const;
export const PARTNER_INQUIRY_STATUSES = ["new", "contacted", "approved", "declined", "converted"] as const;
export const PARTNER_STATUSES = ["active", "inactive"] as const;
export const PARTNER_CAMPAIGN_KINDS = ["homepage", "footer", "predictions", "leaderboard", "tournament"] as const;
export const PARTNER_CAMPAIGN_STATUSES = ["draft", "active", "paused", "ended"] as const;
export const PARTNER_PAYMENT_METHODS = ["github_sponsors", "bank_transfer", "paypal", "other", "waived"] as const;
export const PARTNER_PAYMENT_STATUSES = ["unpaid", "pending", "paid"] as const;

export type PartnerInterest = (typeof PARTNER_INTERESTS)[number];
export type PartnerInquiryStatus = (typeof PARTNER_INQUIRY_STATUSES)[number];
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];
export type PartnerCampaignKind = (typeof PARTNER_CAMPAIGN_KINDS)[number];
export type PartnerCampaignStatus = (typeof PARTNER_CAMPAIGN_STATUSES)[number];
export type PartnerPaymentMethod = (typeof PARTNER_PAYMENT_METHODS)[number];
export type PartnerPaymentStatus = (typeof PARTNER_PAYMENT_STATUSES)[number];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalUrl(value: unknown, label: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const raw = str(value);
  if (!raw) return { ok: true, value: null };
  if (raw.length > 512) return { ok: false, error: `${label} URL is too long.` };
  if (!isSafeUrl(raw)) return { ok: false, error: `${label} must be a valid http(s) URL.` };
  return { ok: true, value: raw };
}

function oneOf<T extends readonly string[]>(value: unknown, allowed: T, fallback?: T[number]): T[number] | null {
  const raw = str(value);
  if ((allowed as readonly string[]).includes(raw)) return raw as T[number];
  return fallback ?? null;
}

function parseUnixSeconds(value: unknown): number | null | "invalid" {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    const n = Math.trunc(value);
    return Number.isSafeInteger(n) && n > 0 ? n : "invalid";
  }
  const raw = str(value);
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return Number.isSafeInteger(n) && n > 0 ? n : "invalid";
  }
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const date = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isFinite(date) ? Math.floor(date / 1000) : "invalid";
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "invalid" : Math.floor(date.getTime() / 1000);
}

export type PartnerInquiryInput = {
  organizationName: string;
  contactName: string;
  email: string;
  websiteUrl: string | null;
  interest: PartnerInterest;
  message: string;
};

export function validatePartnerInquiryInput(
  raw: unknown,
): { ok: true; value: PartnerInquiryInput } | { ok: false; error: string } {
  const body = (raw ?? {}) as Record<string, unknown>;
  const organizationName = str(body.organizationName).slice(0, 160);
  const contactName = str(body.contactName).slice(0, 120);
  const email = str(body.email).toLowerCase();
  const message = str(body.message).slice(0, 2000);
  const interest = oneOf(body.interest, PARTNER_INTERESTS);

  if (!organizationName) return { ok: false, error: "Organization name is required." };
  if (!contactName) return { ok: false, error: "Contact name is required." };
  if (!EMAIL_RE.test(email) || email.length > 254) return { ok: false, error: "A valid email is required." };
  if (!interest) return { ok: false, error: "Choose a partnership interest." };
  if (!message) return { ok: false, error: "Tell us what you want to support." };

  const website = optionalUrl(body.websiteUrl, "Website");
  if (!website.ok) return website;

  return { ok: true, value: { organizationName, contactName, email, websiteUrl: website.value, interest, message } };
}

export type PartnerInput = {
  slug: string;
  name: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  summary: string;
  status: PartnerStatus;
};

export function validatePartnerInput(raw: unknown): { ok: true; value: PartnerInput } | { ok: false; error: string } {
  const body = (raw ?? {}) as Record<string, unknown>;
  const slug = normalizeSlug(str(body.slug));
  const name = str(body.name).slice(0, 160);
  const summary = str(body.summary).slice(0, 600);
  const status = oneOf(body.status, PARTNER_STATUSES, "active");
  if (!slug) return { ok: false, error: "A URL slug is required." };
  if (!name) return { ok: false, error: "Partner name is required." };

  const logo = optionalUrl(body.logoUrl, "Logo");
  if (!logo.ok) return logo;
  const website = optionalUrl(body.websiteUrl, "Website");
  if (!website.ok) return website;

  return { ok: true, value: { slug, name, logoUrl: logo.value, websiteUrl: website.value, summary, status: status! } };
}

export type PartnerCampaignInput = {
  partnerId: number;
  kind: PartnerCampaignKind;
  target: string;
  title: string;
  note: string;
  startAt: number | null;
  endAt: number | null;
  status: PartnerCampaignStatus;
  paymentMethod: PartnerPaymentMethod;
  paymentStatus: PartnerPaymentStatus;
  paymentReference: string | null;
};

export function validatePartnerCampaignInput(
  raw: unknown,
): { ok: true; value: PartnerCampaignInput } | { ok: false; error: string } {
  const body = (raw ?? {}) as Record<string, unknown>;
  const partnerId = Math.trunc(Number(body.partnerId));
  if (!Number.isSafeInteger(partnerId) || partnerId <= 0) {
    return { ok: false, error: "Choose a partner." };
  }
  const kind = oneOf(body.kind, PARTNER_CAMPAIGN_KINDS);
  if (!kind) return { ok: false, error: "Choose a placement." };

  const startAt = parseUnixSeconds(body.startAt);
  if (startAt === "invalid") return { ok: false, error: "Start date is invalid." };
  const endAt = parseUnixSeconds(body.endAt);
  if (endAt === "invalid") return { ok: false, error: "End date is invalid." };
  if (startAt && endAt && endAt < startAt) {
    return { ok: false, error: "End date must be after start date." };
  }

  return {
    ok: true,
    value: {
      partnerId,
      kind,
      target: str(body.target).slice(0, 120),
      title: str(body.title).slice(0, 160),
      note: str(body.note).slice(0, 600),
      startAt,
      endAt,
      status: oneOf(body.status, PARTNER_CAMPAIGN_STATUSES, "draft")!,
      paymentMethod: oneOf(body.paymentMethod, PARTNER_PAYMENT_METHODS, "github_sponsors")!,
      paymentStatus: oneOf(body.paymentStatus, PARTNER_PAYMENT_STATUSES, "unpaid")!,
      paymentReference: str(body.paymentReference).slice(0, 240) || null,
    },
  };
}
