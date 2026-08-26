import { createHmac } from 'node:crypto';

// The Hacking Games x Esports Community gamer survey — ONE source of truth for
// wording, options, canonical values, and Discord component shape.
//
// Two presentation layers share these definitions so they cannot drift:
//   ar -> what the community member sees (modal, announcement, confirmations)
//   en -> what staff and THG see (log embed, THG DM, /thg_survey results, CSV)
// Only the canonical `value` is persisted; both languages are rendered from it.
//
// Question wording and options are transcribed from THG's own Google Form
// (https://kcufkl.s.gy/SaudiGamers). Changing any question, option, or value
// REQUIRES a new `version` below — duplicate detection and every stored answer
// set is keyed by it.

export const THG_SURVEY = {
  version: 'thg-saudi-cyber-2026-v1',
  title: {
    ar: 'استبيان قصير للاعبين',
    en: 'Saudi Gaming & Cybersecurity Interest Survey',
  },
  // Discord caps modal titles at 45 characters.
  modalTitle: {
    ar: 'اهتمام اللاعبين بالأمن السيبراني',
    en: 'Gamer Cybersecurity Interest',
  },
  announcement: {
    ar:
      'نعمل بالتعاون مع The Hacking Games لفهم مدى اهتمام اللاعبين في السعودية بمجال الأمن السيبراني، ' +
      'وكيف يمكن للمهارات التي يكتسبونها من الألعاب أن ترتبط بفرص مهنية في المجال.\n\n' +
      'الاستبيان عبارة عن 4 أسئلة فقط ولن يستغرق أكثر من دقيقة.\n\n' +
      'هدفنا حاليًا هو معرفة آرائكم واهتماماتكم فقط، وليس التسجيل في ورشة أو برنامج.',
  },
  cta: { ar: 'شارك في الاستبيان' },
  intro: {
    ar: 'نبي نعرف رأيك كلاعب عن مجال الأمن السيبراني. 4 أسئلة سريعة، والإجابة تستغرق أقل من دقيقة.',
  },
  // Shown before submitting, in the announcement AND inside the modal: answers
  // do leave the server, so claiming full anonymity would be inaccurate.
  privacyNotice: {
    ar:
      'سيتم مشاركة إجابات الاستبيان مع The Hacking Games لأغراض دراسة اهتمام مجتمع الألعاب بالمجال، ' +
      'بدون مشاركة اسم حسابك في ديسكورد.',
  },
  questions: [
    {
      id: 'q1',
      customId: 'thg_survey:q1',
      type: 'checkbox_group',
      required: true,
      minValues: 1,
      maxValues: 8,
      label: { ar: 'أي نوع ألعاب تلعب غالبًا؟', en: 'Which types of games do you mainly play?' },
      description: { ar: 'يمكنك اختيار أكثر من إجابة', en: 'Select all that apply' },
      options: [
        {
          value: 'fps',
          label: { ar: 'تصويب FPS (فالورانت، CS، رينبو سكس)', en: 'FPS (e.g., Valorant, CSGO, Rainbow Six)' },
        },
        { value: 'moba', label: { ar: 'MOBA (ليق أوف ليجندز، دوتا 2)', en: 'MOBA (e.g., League of Legends, Dota 2)' } },
        {
          value: 'battle_royale',
          label: { ar: 'باتل رويال (ببجي، فورتنايت، أيبكس)', en: 'Battle Royale (e.g., PUBG, Fortnite, Apex Legends)' },
        },
        {
          value: 'strategy',
          label: { ar: 'استراتيجية (ستاركرافت، ايج أوف إمبايرز)', en: 'Strategy (e.g., StarCraft, Age of Empires)' },
        },
        {
          value: 'rpg',
          label: { ar: 'RPG (وورلد أوف ووركرافت، فاينل فانتسي)', en: 'RPG (e.g., World of Warcraft, Final Fantasy)' },
        },
        {
          value: 'fighting',
          label: {
            ar: 'قتال (ستريت فايتر، تيكن، مورتال كومبات)',
            en: 'Fighting (e.g., Street Fighter, Tekken, Mortal Kombat)',
          },
        },
        { value: 'sports_racing', label: { ar: 'رياضة وسباقات', en: 'Sports / Racing' } },
        { value: 'mobile_casual', label: { ar: 'ألعاب جوال وكاجوال', en: 'Mobile / casual games' } },
      ],
    },
    {
      id: 'q2',
      customId: 'thg_survey:q2',
      type: 'checkbox_group',
      required: true,
      minValues: 1,
      maxValues: 8,
      label: { ar: 'هل سبق وسويت أي من هذي الأمور؟', en: 'Have you ever done any of the following?' },
      description: { ar: 'يمكنك اختيار أكثر من إجابة', en: 'Select all that apply' },
      options: [
        { value: 'custom_maps', label: { ar: 'سويت خرائط أو مراحل خاصة', en: 'Created custom maps or levels' } },
        {
          value: 'code_scripts',
          label: { ar: 'كتبت كود أو سكربتات للألعاب', en: 'Written code or scripts for games' },
        },
        { value: 'mods', label: { ar: 'سويت مودات أو محتوى مخصص', en: 'Made mods or custom content' } },
        {
          value: 'server_admin',
          label: {
            ar: 'أدرت سيرفر لعبة أو مجتمع أونلاين',
            en: 'Run or helped admin a game server or online community',
          },
        },
        {
          value: 'glitch_speedrun',
          label: { ar: 'دورت على قلتشات أو سويت سبيدرن', en: 'Hunted glitches or done speedrunning' },
        },
        {
          value: 'hardware_mods',
          label: {
            ar: 'ركبت أو عدلت أجهزة أو يدات أو ملحقات',
            en: 'Built or modified PCs, controllers or peripherals',
          },
        },
        {
          value: 'reverse_engineering',
          label: { ar: 'حللت ملفات أو كود لعبة (هندسة عكسية)', en: 'Reverse engineered game files or code' },
        },
        { value: 'none_yet', label: { ar: 'ولا وحدة منها (لين الآن)', en: 'None of these (yet)' } },
      ],
    },
    {
      id: 'q3',
      customId: 'thg_survey:q3',
      type: 'radio_group',
      required: true,
      // `label.en` is THG's question verbatim — it is never rendered in a
      // Discord Label, only in staff surfaces. `label.ar` IS rendered, so it
      // must fit the 45-character cap; the rest of the question moves into the
      // Arabic description.
      label: {
        ar: 'ورشة مجانية عن الألعاب والأمن السيبراني',
        en: 'If you were invited to a free workshop on Gaming and Cybersecurity in October, would you be interested?',
      },
      description: { ar: 'لو اندعيت لها في أكتوبر، بتكون مهتم؟ اختر إجابة واحدة', en: 'Select one' },
      options: [
        {
          value: 'yes_18_plus',
          label: { ar: 'نعم، وأأكد أن عمري 18 سنة أو أكثر', en: 'Yes, and I confirm I am 18 or over' },
        },
        { value: 'maybe', label: { ar: 'ممكن', en: 'Maybe' } },
        { value: 'no', label: { ar: 'لا', en: 'No' } },
      ],
    },
    {
      id: 'q4',
      customId: 'thg_survey:q4',
      type: 'text',
      required: false,
      maxLength: 200,
      // THG's own optional contact question. Flagged sensitive so notification
      // and export paths treat it deliberately rather than as ordinary answer
      // text — it is the ONLY field in this survey that can carry PII.
      sensitive: true,
      label: {
        ar: 'وين نقدر نتواصل معك؟',
        en: "Where can we reach you if you're shortlisted for the workshop?",
      },
      description: { ar: 'لو ترشحت للورشة. اختياري — اتركه فاضي إذا ما تبي', en: 'Optional' },
      placeholder: { ar: 'إيميل أو حساب تواصل' },
    },
  ],
};

export const THG_SURVEY_SUCCESS_AR =
  'شكرًا لمشاركتك\nإجاباتك بتساعدنا نفهم بشكل أفضل مدى اهتمام اللاعبين في السعودية بمجال الأمن السيبراني.';
export const THG_SURVEY_DUPLICATE_AR = 'سبق وشاركت في هذا الاستبيان، شكرًا لك.';
export const THG_SURVEY_ERROR_AR = 'صار خطأ أثناء حفظ إجابتك. حاول مرة أخرى بعد قليل.';
export const THG_SURVEY_UNAVAILABLE_AR = 'الاستبيان غير متاح حاليًا. تواصل مع الإدارة.';
export const THG_SURVEY_REQUIRED_AR = 'لازم تجاوب على كل الأسئلة المطلوبة قبل الإرسال.';

// Discord component limits (docs.discord.com/developers/components/reference).
// Enforced here so a wording change fails a unit test instead of a live modal.
export const DISCORD_LIMITS = {
  modalTitle: 45,
  modalComponents: 5,
  customId: 100,
  labelText: 45,
  labelDescription: 100,
  optionLabel: 100,
  optionValue: 100,
  radioGroupOptions: { min: 2, max: 10 },
  checkboxGroupOptions: { min: 1, max: 10 },
  textInputMaxLength: 4000,
};

export function surveyQuestion(id, survey = THG_SURVEY) {
  return survey.questions.find((question) => question.id === id) || null;
}

// Fail loudly in tests / at feature invocation rather than when Discord rejects
// the modal. Returns the list of problems so an admin can be told what is wrong.
export function validateSurveyDefinition(survey = THG_SURVEY) {
  const problems = [];
  const push = (message) => problems.push(message);

  if (!survey.version) push('survey version is missing');
  if ((survey.modalTitle?.ar || '').length > DISCORD_LIMITS.modalTitle) {
    push(`modal title exceeds ${DISCORD_LIMITS.modalTitle} characters`);
  }
  // The intro Text Display occupies one of the modal's five top-level slots.
  if (survey.questions.length + 1 > DISCORD_LIMITS.modalComponents) {
    push(
      `modal would need ${survey.questions.length + 1} top-level components (max ${DISCORD_LIMITS.modalComponents})`,
    );
  }

  const seenIds = new Set();
  const seenCustomIds = new Set();
  for (const question of survey.questions) {
    const at = `question ${question.id}`;
    if (seenIds.has(question.id)) push(`duplicate question id ${question.id}`);
    seenIds.add(question.id);
    if (seenCustomIds.has(question.customId)) push(`duplicate custom id ${question.customId}`);
    seenCustomIds.add(question.customId);
    if (!question.customId || question.customId.length > DISCORD_LIMITS.customId) {
      push(`${at}: custom id must be 1-${DISCORD_LIMITS.customId} characters`);
    }
    for (const lang of ['ar', 'en']) {
      if (!question.label?.[lang]) push(`${at}: missing ${lang} label`);
    }
    if ((question.label?.ar || '').length > DISCORD_LIMITS.labelText) {
      push(`${at}: Arabic label exceeds ${DISCORD_LIMITS.labelText} characters`);
    }
    if ((question.description?.ar || '').length > DISCORD_LIMITS.labelDescription) {
      push(`${at}: Arabic description exceeds ${DISCORD_LIMITS.labelDescription} characters`);
    }

    if (question.type === 'text') {
      if ((question.maxLength || 0) > DISCORD_LIMITS.textInputMaxLength) {
        push(`${at}: max length above Discord's limit`);
      }
      continue;
    }

    const bounds =
      question.type === 'radio_group' ? DISCORD_LIMITS.radioGroupOptions : DISCORD_LIMITS.checkboxGroupOptions;
    const options = question.options || [];
    if (options.length < bounds.min || options.length > bounds.max) {
      push(`${at}: ${options.length} options (allowed ${bounds.min}-${bounds.max})`);
    }
    const seenValues = new Set();
    for (const option of options) {
      if (seenValues.has(option.value)) push(`${at}: duplicate option value ${option.value}`);
      seenValues.add(option.value);
      if (!option.value || option.value.length > DISCORD_LIMITS.optionValue) {
        push(`${at}: option value must be 1-${DISCORD_LIMITS.optionValue} characters`);
      }
      for (const lang of ['ar', 'en']) {
        const label = option.label?.[lang] || '';
        if (!label) push(`${at}: option ${option.value} missing ${lang} label`);
        if (label.length > DISCORD_LIMITS.optionLabel) {
          push(`${at}: option ${option.value} ${lang} label exceeds ${DISCORD_LIMITS.optionLabel} characters`);
        }
      }
    }
    if (question.type === 'checkbox_group') {
      if (question.required && (question.minValues || 0) < 1) {
        push(`${at}: required checkbox group needs min_values >= 1`);
      }
      if ((question.maxValues || 0) > options.length) push(`${at}: max_values exceeds the option count`);
    }
  }

  return problems;
}

// --- Submission parsing ------------------------------------------------------
// Operates on the modal-submit component tree (interaction.components), where a
// Label (type 18) WRAPS its input under `component`. Legacy action rows (type 1,
// `components[]`) are still walked so an older cached modal cannot hard-fail.
function flattenModalComponents(components) {
  const byCustomId = new Map();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node.components)) {
      for (const child of node.components) walk(child);
      return;
    }
    if (node.component) {
      walk(node.component);
      return;
    }
    if (node.customId) byCustomId.set(node.customId, node);
  };
  for (const node of Array.isArray(components) ? components : []) walk(node);
  return byCustomId;
}

function normalizeText(value, maxLength) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

/**
 * Parse a modal submission into canonical answers.
 * @returns {{ ok: boolean, answers: Object, errors: string[] }}
 */
export function parseSurveySubmission(components, survey = THG_SURVEY) {
  const byCustomId = flattenModalComponents(components);
  const answers = {};
  const errors = [];

  for (const question of survey.questions) {
    const field = byCustomId.get(question.customId);
    if (!field) {
      // A malformed payload must not silently lose the answers that DID arrive.
      if (question.required) errors.push(`${question.id}: missing`);
      if (question.type === 'checkbox_group') answers[question.id] = [];
      else answers[question.id] = question.type === 'text' ? '' : null;
      continue;
    }

    if (question.type === 'text') {
      const text = normalizeText(field.value, question.maxLength || DISCORD_LIMITS.textInputMaxLength);
      if (question.required && !text) errors.push(`${question.id}: required`);
      answers[question.id] = text;
      continue;
    }

    const allowed = new Set((question.options || []).map((option) => option.value));
    if (question.type === 'radio_group') {
      const value = typeof field.value === 'string' && field.value ? field.value : null;
      if (value && !allowed.has(value)) {
        errors.push(`${question.id}: unknown option`);
        answers[question.id] = null;
        continue;
      }
      if (question.required && !value) errors.push(`${question.id}: required`);
      answers[question.id] = value;
      continue;
    }

    // checkbox_group — keep definition order so exports stay comparable.
    const submitted = Array.isArray(field.values) ? field.values : [];
    const selected = new Set(submitted.filter((value) => allowed.has(value)));
    const values = (question.options || []).map((option) => option.value).filter((value) => selected.has(value));
    if (submitted.some((value) => !allowed.has(value))) errors.push(`${question.id}: unknown option`);
    if (question.required && values.length < (question.minValues || 1)) errors.push(`${question.id}: required`);
    answers[question.id] = values;
  }

  return { ok: errors.length === 0, answers, errors };
}

// --- Rendering ---------------------------------------------------------------
export function renderAnswer(question, value, lang = 'en') {
  if (!question) return '';
  if (question.type === 'text') return String(value ?? '');
  const labelFor = (candidate) => {
    const option = (question.options || []).find((entry) => entry.value === candidate);
    return option?.label?.[lang] || option?.label?.en || String(candidate);
  };
  if (question.type === 'radio_group') return value ? labelFor(value) : '';
  return (Array.isArray(value) ? value : []).map(labelFor).join(', ');
}

// --- Aggregation -------------------------------------------------------------
function percent(count, total) {
  return total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
}

/**
 * Aggregate stored responses for /thg_survey results.
 * Reads only `answers` — nothing here can carry a respondent identifier.
 */
export function aggregateResponses(responses, survey = THG_SURVEY) {
  const rows = Array.isArray(responses) ? responses : [];
  const total = rows.length;
  const questions = survey.questions.map((question) => {
    if (question.type === 'text') {
      const filled = rows.filter((row) => String(row.answers?.[question.id] ?? '').trim().length > 0).length;
      return {
        id: question.id,
        type: question.type,
        question: question.label.en,
        sensitive: Boolean(question.sensitive),
        answered: filled,
        answeredPercent: percent(filled, total),
        blank: total - filled,
      };
    }

    const counts = new Map((question.options || []).map((option) => [option.value, 0]));
    // Multi-select percentages are of RESPONDENTS, not of selections, so they
    // legitimately sum above 100%.
    let responders = 0;
    for (const row of rows) {
      const value = row.answers?.[question.id];
      const selected = question.type === 'radio_group' ? (value ? [value] : []) : Array.isArray(value) ? value : [];
      if (selected.length) responders += 1;
      for (const entry of selected) {
        if (counts.has(entry)) counts.set(entry, counts.get(entry) + 1);
      }
    }
    const denominator = question.type === 'radio_group' ? total : responders;
    return {
      id: question.id,
      type: question.type,
      question: question.label.en,
      sensitive: false,
      responders,
      options: (question.options || []).map((option) => ({
        value: option.value,
        label: option.label.en,
        count: counts.get(option.value) || 0,
        percent: percent(counts.get(option.value) || 0, denominator),
      })),
    };
  });

  return { version: survey.version, total, questions };
}

// --- CSV export --------------------------------------------------------------
export const CSV_MULTI_SELECT_SEPARATOR = '; ';

function csvCell(value) {
  const text = String(value ?? '');
  // Neutralize spreadsheet formula injection from the one free-text answer.
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /["\n\r,]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/**
 * Build the THG-facing CSV. Deliberately excludes guild id, respondent hash and
 * every Discord identifier — the hash exists only for de-duplication.
 */
export function responsesToCsv(responses, survey = THG_SURVEY) {
  const header = ['submitted_at', 'survey_version', ...survey.questions.map((question) => question.id)];
  const questionRow = ['', '', ...survey.questions.map((question) => question.label.en)];
  const lines = [header.map(csvCell).join(','), questionRow.map(csvCell).join(',')];

  for (const response of Array.isArray(responses) ? responses : []) {
    const cells = [new Date(response.submittedAt * 1000).toISOString(), response.surveyVersion || survey.version];
    for (const question of survey.questions) {
      const value = response.answers?.[question.id];
      if (question.type === 'checkbox_group') {
        const labels = (Array.isArray(value) ? value : []).map((entry) => renderAnswer(question, [entry], 'en'));
        cells.push(labels.join(CSV_MULTI_SELECT_SEPARATOR));
      } else if (question.type === 'radio_group') {
        cells.push(renderAnswer(question, value, 'en'));
      } else {
        cells.push(String(value ?? ''));
      }
    }
    lines.push(cells.map(csvCell).join(','));
  }

  return `${lines.join('\n')}\n`;
}

// --- Pseudonymous de-duplication --------------------------------------------
// The raw Discord user id is never stored. The HMAC is stable per guild+member
// so a repeat submission collides on the unique index, and it is useless to THG
// (who never receive it) and not reversible into a user id without the secret.
export function respondentHash(secret, guildId, userId) {
  if (!secret) throw new Error('SURVEY_HASH_SECRET is not configured.');
  return createHmac('sha256', secret).update(`${guildId}:${userId}`).digest('hex');
}
