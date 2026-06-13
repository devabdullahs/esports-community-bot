// Local dev only — never run against the production DB; refuses if DB_PATH is unset.
// Populates a sample dashboard DB so the website can be browsed visually in EN + AR.
// Run with DB_PATH already set, e.g.:
//   DB_PATH="/tmp/dev-dashboard.sqlite" npm run seed:dev
import process from 'node:process';

if (!process.env.DB_PATH) {
  console.error('Refusing to run: set DB_PATH to a DISPOSABLE sqlite path first.');
  process.exit(1);
}

const GUILD = '1200000000000000001';
const SEASON = '2026';
const DEV_DISCORD_ID = '100000000000000001'; // dev-auth bypass discord id
const DEV_AUTH_USER = 'dev-local-auth-user'; // dev-auth bypass auth user id

const { closeDb } = await import('../src/db/index.js');
const { listEwcGames } = await import('../src/db/ewcGames.js');
const { listEwcMediaChannels } = await import('../src/db/ewcMediaChannels.js');
const { createEwcNewsPost } = await import('../src/db/ewcNewsPosts.js');
const {
  upsertEwcSeason,
  upsertEwcWeek,
  setEwcWeekSnapshot,
  markEwcWeekScored,
  upsertSeasonPrediction,
  saveSeasonPredictionScore,
  upsertWeeklyPrediction,
  saveWeeklyPredictionScore,
} = await import('../src/db/ewcPredictions.js');
const { upsertEwcProfileLink, markEwcProfileLinkSynced } = await import('../src/db/ewcProfileLinks.js');
const { addTournament } = await import('../src/db/tournaments.js');
const { upsertMatch } = await import('../src/db/matches.js');

// 1) Trigger the built-in default seeds for games + media channels.
const games = listEwcGames();
const media = listEwcMediaChannels();
console.log(`games seeded: ${games.length}, media seeded: ${media.length}`);
const gameSlugs = games.map((g) => g.slug);
const pick = (i) => gameSlugs[i % gameSlugs.length] || 'valorant';

// 2) News posts (mix of shared + bilingual, published).
const posts = [
  {
    gameSlug: pick(0),
    contentMode: 'shared',
    defaultLocale: 'en',
    status: 'published',
    authorName: 'Community Desk',
    authorDiscordId: DEV_DISCORD_ID,
    translations: {
      en: {
        title: 'Falcons storm into the EWC group stage',
        summary: 'A dominant opening series sets the tone for week one.',
        body: '## Opening day\n\nTeam Falcons opened the season with a **2-0** sweep.\n\n- Clinical mid-round control\n- Zero economy slips\n- Crowd firmly behind the home side\n\nNext up: a marquee clash against Team Vitality.',
      },
    },
  },
  {
    gameSlug: pick(1),
    contentMode: 'translated',
    defaultLocale: 'en',
    status: 'published',
    authorName: 'Community Desk',
    authorDiscordId: DEV_DISCORD_ID,
    translations: {
      en: {
        title: 'Bracket preview: the road to the final',
        summary: 'Eight teams, one trophy — here is how the bracket breaks down.',
        body: '## Bracket preview\n\nThe upper bracket looks brutal this year.\n\n1. Gen.G\n2. T1\n3. G2 Esports\n\nKeep an eye on the lower-bracket run.',
      },
      ar: {
        title: 'نظرة على الأقواس: الطريق إلى النهائي',
        summary: 'ثمانية فرق وكأس واحدة — هكذا تتوزّع الأقواس.',
        body: '## نظرة على الأقواس\n\nيبدو القوس العلوي شرسًا هذا العام.\n\n1. Gen.G\n2. T1\n3. G2 Esports\n\nترقّبوا مسار القوس السفلي.',
      },
    },
  },
  {
    gameSlug: pick(2),
    contentMode: 'shared',
    defaultLocale: 'ar',
    status: 'published',
    authorName: 'فريق التحرير',
    authorDiscordId: DEV_DISCORD_ID,
    translations: {
      ar: {
        title: 'تيم فالكونز يتصدّر ترتيب الأسبوع',
        summary: 'انطلاقة قويّة تضع الفريق على رأس القائمة.',
        body: '## ملخّص الأسبوع\n\nحقّق **تيم فالكونز** انتصارين متتاليين.\n\n- سيطرة واضحة في منتصف الجولات\n- انضباط اقتصادي مثالي\n\nالمباراة القادمة ضدّ Team Vitality.',
      },
    },
  },
  {
    gameSlug: pick(0),
    contentMode: 'translated',
    defaultLocale: 'en',
    status: 'published',
    authorName: 'Community Desk',
    authorDiscordId: DEV_DISCORD_ID,
    translations: {
      en: {
        title: 'Power rankings after week two',
        summary: 'The standings shuffle as the title race tightens.',
        body: '## Power rankings\n\nMovement at the top after a chaotic week.\n\n- Falcons hold #1\n- Vitality climb to #2\n- Liquid slip to #4',
      },
      ar: {
        title: 'تصنيف القوّة بعد الأسبوع الثاني',
        summary: 'تبدّل في الترتيب مع اشتداد سباق اللقب.',
        body: '## تصنيف القوّة\n\nتغيّرات في القمّة بعد أسبوع صاخب.\n\n- فالكونز يحافظ على المركز الأول\n- Vitality يصعد للثاني\n- Liquid يتراجع للرابع',
      },
    },
  },
];
let newsCount = 0;
for (const p of posts) {
  try { createEwcNewsPost(p); newsCount += 1; } catch (e) { console.warn('news skip:', e.message); }
}
console.log(`news posts created: ${newsCount}`);

// 3) EWC prediction season + two scored weekly rounds + a leaderboard of members.
upsertEwcSeason({ guildId: GUILD, season: SEASON, label: 'EWC 2026', topSize: 10, createdBy: 'seed' });

const CLUBS = ['Team Falcons', 'Team Vitality', 'Team Liquid', 'Gen.G', 'T1', 'FaZe Clan', 'Natus Vincere', 'G2 Esports', 'Cloud9', 'Fnatic'];
const standings = (order) => order.map((team, i) => ({ team, rank: i + 1, points: (order.length - i) * 100 }));
const finalStandings = standings(CLUBS);
const baselineStandings = standings([...CLUBS].reverse());

const weeks = [
  { key: 'week-1', label: 'Week 1' },
  { key: 'week-2', label: 'Week 2' },
];
const weekRows = [];
for (const w of weeks) {
  const row = upsertEwcWeek({ guildId: GUILD, season: SEASON, weekKey: w.key, label: w.label, createdBy: 'seed' });
  setEwcWeekSnapshot(row.id, 'baseline', baselineStandings);
  weekRows.push(row);
}

// Members: the dev user first (so /me has data) + a sample roster.
const members = [
  { id: DEV_DISCORD_ID, weekly: [1180, 940], season: 1450 },
  { id: '100000000000000002', weekly: [1320, 1010], season: 1600 },
  { id: '100000000000000003', weekly: [1060, 1180], season: 1390 },
  { id: '100000000000000004', weekly: [880, 1240], season: 1280 },
  { id: '100000000000000005', weekly: [1240, 760], season: 1100 },
  { id: '100000000000000006', weekly: [640, 980], season: 990 },
  { id: '100000000000000007', weekly: [1020, 1020], season: 1340 },
  { id: '100000000000000008', weekly: [760, 600], season: 720 },
];
const picksFor = (offset) => [CLUBS[offset % CLUBS.length], CLUBS[(offset + 1) % CLUBS.length], CLUBS[(offset + 2) % CLUBS.length]];

members.forEach((m, mi) => {
  // Season prediction (top-10 ordering) + score.
  const seasonPicks = [...CLUBS.slice(mi % 3), ...CLUBS.slice(0, mi % 3)];
  upsertSeasonPrediction({ guildId: GUILD, season: SEASON, userId: m.id, picks: seasonPicks });
  saveSeasonPredictionScore(GUILD, SEASON, m.id, m.season, { picks: seasonPicks.map((team) => ({ pick: team })) });
  // Weekly predictions + scores.
  weekRows.forEach((row, wi) => {
    const picks = picksFor(mi + wi);
    upsertWeeklyPrediction({ guildId: GUILD, weekId: row.id, userId: m.id, picks });
    saveWeeklyPredictionScore(GUILD, row.id, m.id, m.weekly[wi], { picks: picks.map((team) => ({ pick: team })) });
  });
});

// Mark weeks scored with the final standings.
for (const row of weekRows) markEwcWeekScored(row.id, finalStandings);
console.log(`season + ${weekRows.length} weeks scored for ${members.length} members`);

// 3b) One tracked tournament + a few matches so /tournaments has data to render.
// addTournament/upsertMatch upsert on their unique keys, so re-running is idempotent.
const tournament = addTournament({
  source: 'liquipedia',
  external_id: 'EWC/2026/Valorant',
  game: 'valorant',
  name: 'EWC 2026 — Valorant',
  url: 'https://liquipedia.net/valorant/EWC/2026',
  guild_id: GUILD,
});
const nowSeconds = Math.floor(Date.now() / 1000);
const tMatches = [
  { external_id: 'Match:val-run', team_a: 'Team Falcons', team_b: 'Team Liquid', score_a: 1, score_b: 0, status: 'running', scheduled_at: nowSeconds - 1800 },
  { external_id: 'Match:val-sch', team_a: 'Team Vitality', team_b: 'Gen.G', score_a: null, score_b: null, status: 'scheduled', scheduled_at: nowSeconds + 7200 },
  { external_id: 'Match:val-fin', team_a: 'T1', team_b: 'FaZe Clan', score_a: 2, score_b: 1, status: 'finished', scheduled_at: nowSeconds - 86400 },
];
let matchCount = 0;
for (const m of tMatches) {
  try { upsertMatch({ tournament_id: tournament.id, source: 'liquipedia', ...m }); matchCount += 1; }
  catch (e) { console.warn('match skip:', e.message); }
}
console.log(`tournament seeded: ${tournament.name} (#${tournament.id}) with ${matchCount} matches`);

// 4) Link the dev auth user to this guild/season so /me resolves automatically.
upsertEwcProfileLink({ authUserId: DEV_AUTH_USER, discordUserId: DEV_DISCORD_ID, guildId: GUILD, season: SEASON });
markEwcProfileLinkSynced(DEV_DISCORD_ID);
console.log(`profile link created for dev user ${DEV_DISCORD_ID} → guild ${GUILD}`);

closeDb();
console.log('\nSeed complete.');
console.log(`Leaderboard URL: /leaderboard/${GUILD}/${SEASON}`);
