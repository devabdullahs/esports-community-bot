// Seed data for the esports media-channels directory. Inserted into ewc_media_channels
// on first boot when the table is empty; afterwards admins manage them from the dashboard.
// Bilingual (en/ar). Logos + platform links are filled in by admins later.
export const DEFAULT_MEDIA_CHANNELS = [
  {
    slug: "echo-mena",
    name: { en: "Echo MENA", ar: "إيكو مينا" },
    description: {
      en: "Esports coverage and highlights across the MENA region.",
      ar: "تغطية ولقطات الرياضات الإلكترونية في منطقة الشرق الأوسط وشمال إفريقيا.",
    },
    logoUrl: null,
    links: [],
  },
  {
    slug: "hype-cast",
    name: { en: "Hype Cast", ar: "هايب كاست" },
    description: {
      en: "Match casts, hype clips, and community moments.",
      ar: "تعليقات المباريات، لقطات الحماس، ولحظات المجتمع.",
    },
    logoUrl: null,
    links: [],
  },
  {
    slug: "spot-media",
    name: { en: "Spot Media", ar: "سبوت ميديا" },
    description: {
      en: "Spotlights on teams, players, and tournaments.",
      ar: "تسليط الضوء على الفرق واللاعبين والبطولات.",
    },
    logoUrl: null,
    links: [],
  },
  {
    slug: "pulse-cast",
    name: { en: "Pulse Cast", ar: "بالس كاست" },
    description: {
      en: "The pulse of the scene — news, takes, and recaps.",
      ar: "نبض المشهد — أخبار وآراء وملخصات.",
    },
    logoUrl: null,
    links: [],
  },
  {
    slug: "sama-news",
    name: { en: "Sama News", ar: "سما نيوز" },
    description: {
      en: "Breaking esports news and announcements.",
      ar: "آخر أخبار وإعلانات الرياضات الإلكترونية.",
    },
    logoUrl: null,
    links: [],
  },
  {
    slug: "nara-media",
    name: { en: "Nara Media", ar: "نارا ميديا" },
    description: {
      en: "Stories, features, and long-form esports content.",
      ar: "قصص ومقالات ومحتوى مطوّل عن الرياضات الإلكترونية.",
    },
    logoUrl: null,
    links: [],
  },
];
