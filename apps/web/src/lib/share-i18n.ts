import type { Locale } from "@/lib/i18n";

// Feature-local copy for the post share controls (English + Arabic), kept beside
// the feature like comments-i18n. Small, client-safe, no server imports.
export type ShareCopy = {
  share: string;
  shareOnX: string;
  copyLink: string;
  copied: string;
};

export const shareCopy: Record<Locale, ShareCopy> = {
  en: {
    share: "Share",
    shareOnX: "Share on X",
    copyLink: "Copy link",
    copied: "Copied",
  },
  ar: {
    share: "مشاركة",
    shareOnX: "المشاركة على X",
    copyLink: "نسخ الرابط",
    copied: "تم النسخ",
  },
};
