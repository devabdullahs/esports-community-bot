function freezeEntry(entry) {
  return Object.freeze({
    ...entry,
    surfaces: Object.freeze([...entry.surfaces]),
    title: Object.freeze({ ...entry.title }),
    description: Object.freeze({ ...entry.description }),
  });
}

function namesWhere(predicate) {
  return Object.freeze(MCP_TOOL_MANIFEST.filter(predicate).map((tool) => tool.name));
}

export const MCP_TOOL_MANIFEST = Object.freeze([
  freezeEntry({
    name: 'get_site_overview',
    surfaces: ['public', 'admin'],
    kind: 'read',
    adminGrant: 'selectable',
    scope: 'none',
    title: { en: 'Get site overview', ar: 'عرض ملخص الموقع' },
    description: {
      en: 'Read site and bot counts; admin calls can include scoped dashboard context.',
      ar: 'يعرض أعداد الموقع والبوت، وقد تتضمن المكالمات الإدارية سياقا من لوحة التحكم حسب الصلاحيات.',
    },
  }),
  freezeEntry({
    name: 'list_games',
    surfaces: ['public', 'admin'],
    kind: 'read',
    adminGrant: 'always',
    scope: 'none',
    title: { en: 'List games', ar: 'عرض الألعاب' },
    description: {
      en: 'List the localized public game directory.',
      ar: 'يعرض دليل الألعاب العام حسب اللغة.',
    },
  }),
  freezeEntry({
    name: 'get_admin_capabilities',
    surfaces: ['admin'],
    kind: 'read',
    adminGrant: 'always',
    scope: 'none',
    title: { en: 'Get admin capabilities', ar: 'عرض صلاحيات المفتاح الإداري' },
    description: {
      en: 'Discover this MCP key\'s usable tools, allowed game and media IDs, and writable stream channel IDs.',
      ar: 'يعرض الأدوات المتاحة لهذا المفتاح ومعرفات الألعاب والقنوات الإعلامية وقنوات البث التي يمكنه استخدامها.',
    },
  }),
  freezeEntry({
    name: 'search_news',
    surfaces: ['public', 'admin'],
    kind: 'read',
    adminGrant: 'selectable',
    scope: 'game-or-media',
    title: { en: 'Search news', ar: 'البحث في الأخبار' },
    description: {
      en: 'Search published news publicly or admin-visible posts within the key scope.',
      ar: 'يبحث في الأخبار المنشورة للعامة أو في أخبار الإدارة الظاهرة ضمن نطاق المفتاح.',
    },
  }),
  freezeEntry({
    name: 'get_tournament_status',
    surfaces: ['public', 'admin'],
    kind: 'read',
    adminGrant: 'selectable',
    scope: 'game',
    title: { en: 'Get tournament status', ar: 'عرض حالة البطولة' },
    description: {
      en: 'Read matches and standings for one tracked tournament.',
      ar: 'يعرض المباريات والترتيب لبطولة واحدة متتبعة.',
    },
  }),
  freezeEntry({
    name: 'list_tournaments',
    surfaces: ['public', 'admin'],
    kind: 'read',
    adminGrant: 'always',
    scope: 'none',
    title: { en: 'List tournaments', ar: 'عرض البطولات' },
    description: {
      en: 'List public active tournament summaries.',
      ar: 'يعرض ملخصات البطولات العامة النشطة.',
    },
  }),
  freezeEntry({
    name: 'get_ewc_club_summary',
    surfaces: ['public', 'admin'],
    kind: 'read',
    adminGrant: 'selectable',
    scope: 'none',
    title: { en: 'Get EWC club summary', ar: 'عرض ملخص أندية EWC' },
    description: {
      en: 'Read EWC club points, qualified games, wins, and region metadata.',
      ar: 'يعرض نقاط أندية EWC والألعاب المتأهلة والانتصارات وبيانات المناطق.',
    },
  }),
  freezeEntry({
    name: 'get_ewc_club_standings',
    surfaces: ['public', 'admin'],
    kind: 'read',
    adminGrant: 'always',
    scope: 'none',
    title: { en: 'Get EWC Club Championship standings', ar: '\u0639\u0631\u0636 \u062a\u0631\u062a\u064a\u0628 \u0628\u0637\u0648\u0644\u0629 \u0623\u0646\u062f\u064a\u0629 EWC' },
    description: {
      en: 'Read the official rank-ordered EWC Club Championship standings from the latest stored snapshot.',
      ar: '\u064a\u0639\u0631\u0636 \u062a\u0631\u062a\u064a\u0628 \u0628\u0637\u0648\u0644\u0629 \u0623\u0646\u062f\u064a\u0629 EWC \u0627\u0644\u0631\u0633\u0645\u064a \u0645\u0646 \u0622\u062e\u0631 \u0646\u0633\u062e\u0629 \u0645\u062d\u0641\u0648\u0638\u0629.',
    },
  }),
  freezeEntry({
    name: 'list_co_streams',
    surfaces: ['public', 'admin'],
    kind: 'read',
    adminGrant: 'always',
    scope: 'none',
    title: { en: 'List co-streams', ar: 'عرض البثوث المشتركة' },
    description: {
      en: 'List public co-stream groups, live-first.',
      ar: 'يعرض مجموعات البثوث المشتركة العامة مع المباشر أولا.',
    },
  }),
  freezeEntry({
    name: 'search_teams',
    surfaces: ['public', 'admin'],
    kind: 'read',
    adminGrant: 'always',
    scope: 'none',
    title: { en: 'Search teams', ar: 'البحث في الفرق' },
    description: {
      en: 'Search the public team directory with safe public fields.',
      ar: 'يبحث في دليل الفرق العام باستخدام حقول عامة آمنة.',
    },
  }),
  freezeEntry({
    name: 'search_players',
    surfaces: ['public', 'admin'],
    kind: 'read',
    adminGrant: 'always',
    scope: 'none',
    title: { en: 'Search players', ar: 'البحث في اللاعبين' },
    description: {
      en: 'Search the public player directory with safe public fields.',
      ar: 'يبحث في دليل اللاعبين العام باستخدام حقول عامة آمنة.',
    },
  }),
  freezeEntry({
    name: 'get_public_ewc_leaderboard',
    surfaces: ['public', 'admin'],
    kind: 'read',
    adminGrant: 'always',
    scope: 'none',
    title: { en: 'Get public EWC leaderboard', ar: 'عرض لوحة توقعات EWC العامة' },
    description: {
      en: 'Read the public EWC prediction leaderboard projection.',
      ar: 'يعرض لوحة توقعات EWC العامة الحالية.',
    },
  }),
  freezeEntry({
    name: 'list_admin_queue',
    surfaces: ['admin'],
    kind: 'read',
    adminGrant: 'selectable',
    scope: 'none',
    title: { en: 'List admin queue', ar: 'عرض قائمة المراجعة الإدارية' },
    description: {
      en: 'List reported comments needing moderation review.',
      ar: 'يعرض التعليقات المبلغ عنها التي تحتاج إلى مراجعة إدارية.',
    },
  }),
  freezeEntry({
    name: 'create_news_draft',
    surfaces: ['admin'],
    kind: 'write',
    adminGrant: 'selectable',
    scope: 'game-or-media',
    title: { en: 'Create news draft', ar: 'إنشاء مسودة خبر' },
    description: {
      en: 'Create a draft news post in an allowed game or media channel. Requires idempotencyKey for safe retries and never publishes directly.',
      ar: 'ينشئ مسودة خبر في لعبة أو قناة إعلامية مسموح بها، ويتطلب idempotencyKey لإعادة المحاولة بأمان، ولا ينشر مباشرة أبدا.',
    },
  }),
  freezeEntry({
    name: 'update_stream_channel',
    surfaces: ['admin'],
    kind: 'write',
    adminGrant: 'selectable',
    scope: 'stream-game',
    title: { en: 'Update stream channel', ar: 'تحديث قناة بث' },
    description: {
      en: 'Update allowed co-stream rows. Requires idempotencyKey for safe retries.',
      ar: 'يحدث صفوف البث المشترك المسموح بها، ويتطلب idempotencyKey لإعادة المحاولة بأمان.',
    },
  }),
]);

export const PUBLIC_MCP_TOOL_NAMES = namesWhere((tool) => tool.surfaces.includes('public'));
export const ADMIN_MCP_TOOL_NAMES = namesWhere((tool) => tool.surfaces.includes('admin'));
export const ADMIN_ALWAYS_ON_MCP_TOOL_NAMES = namesWhere(
  (tool) => tool.surfaces.includes('admin') && tool.adminGrant === 'always',
);
export const ADMIN_SELECTABLE_MCP_TOOL_NAMES = namesWhere(
  (tool) => tool.surfaces.includes('admin') && tool.adminGrant === 'selectable',
);
export const PUBLIC_ONLY_MCP_TOOL_NAMES = namesWhere(
  (tool) => tool.surfaces.includes('public') && tool.surfaces.includes('admin') && tool.adminGrant === 'always',
);
export const ADMIN_PUBLIC_OVERLAP_TOOL_NAMES = namesWhere(
  (tool) => tool.surfaces.includes('public') && tool.surfaces.includes('admin') && tool.adminGrant === 'selectable',
);
export const MCP_WRITE_TOOL_NAMES = namesWhere((tool) => tool.kind === 'write');

export function getMcpToolManifestEntry(name) {
  return MCP_TOOL_MANIFEST.find((tool) => tool.name === name) || null;
}
