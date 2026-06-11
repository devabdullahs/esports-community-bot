// Seed data for the community game pages. Inserted into ewc_games on first boot when
// the table is empty, after which admins manage games from the dashboard. Bilingual
// (en/ar). No posts here — news posts live in ewc_news_posts.
export const DEFAULT_GAMES = [
  {
    slug: "valorant",
    title: { en: "Valorant", ar: "فالورانت" },
    description: {
      en: "Match reminders, roster notes, tournament links, and short posts for the Valorant channel.",
      ar: "تنبيهات المباريات، أخبار التشكيلات، روابط البطولات، ومنشورات قصيرة لقناة فالورانت.",
    },
    status: { en: "Coverage ready", ar: "التغطية جاهزة" },
    owner: { en: "Game admins", ar: "مشرفو اللعبة" },
    focus: [
      { en: "Match-day posts", ar: "منشورات يوم المباراة" },
      { en: "Roster and patch notes", ar: "أخبار التشكيلات والتحديثات" },
      { en: "Discord announcements", ar: "إعلانات ديسكورد" },
    ],
  },
  {
    slug: "league-of-legends",
    title: { en: "League of Legends", ar: "ليغ أوف ليجندز" },
    description: {
      en: "A home for standings context, community posts, pick notes, and major tournament coverage.",
      ar: "صفحة لسياق الترتيب، منشورات المجتمع، ملاحظات التوقعات، وتغطية البطولات الكبرى.",
    },
    status: { en: "Editorial queue", ar: "قائمة تحرير" },
    owner: { en: "Social managers", ar: "مديرو التواصل" },
    focus: [
      { en: "Tournament summaries", ar: "ملخصات البطولات" },
      { en: "Prediction context", ar: "سياق التوقعات" },
      { en: "Community highlights", ar: "أبرز لقطات المجتمع" },
    ],
  },
  {
    slug: "rocket-league",
    title: { en: "Rocket League", ar: "روكيت ليغ" },
    description: {
      en: "Coverage space for match links, team stories, community watch parties, and highlight posts.",
      ar: "مساحة تغطية لروابط المباريات، قصص الفرق, تجمعات المشاهدة، ومنشورات اللقطات.",
    },
    status: { en: "Community page", ar: "صفحة مجتمع" },
    owner: { en: "Admins", ar: "المشرفون" },
    focus: [
      { en: "Watch parties", ar: "تجمعات المشاهدة" },
      { en: "Highlight posts", ar: "منشورات اللقطات" },
      { en: "Team notes", ar: "ملاحظات الفرق" },
    ],
  },
];
