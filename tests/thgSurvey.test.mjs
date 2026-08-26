import assert from 'node:assert/strict';
import test from 'node:test';
import { ComponentType } from 'discord.js';

process.env.DISCORD_TOKEN ||= 'test-token';
process.env.DISCORD_CLIENT_ID ||= 'test-client-id';
process.env.LOG_LEVEL = 'error';

const {
  aggregateResponses,
  CSV_MULTI_SELECT_SEPARATOR,
  DISCORD_LIMITS,
  parseSurveySubmission,
  renderAnswer,
  respondentHash,
  responsesToCsv,
  surveyQuestion,
  THG_SURVEY,
  validateSurveyDefinition,
} = await import('../src/lib/thgSurvey.js');
const { buildLogEmbed, buildSurveyAnnouncement, buildSurveyModal, buildThgEmbed } = await import(
  '../src/lib/thgSurveyComponents.js'
);

function submission({ q1 = ['fps'], q2 = ['mods'], q3 = 'maybe', q4 = '' } = {}) {
  // Mirrors discord.js' transformed modal payload: a Label (18) WRAPS its input.
  const label = (component) => ({ type: ComponentType.Label, component });
  return [
    { type: ComponentType.TextDisplay },
    label({ type: ComponentType.CheckboxGroup, customId: 'thg_survey:q1', values: q1 }),
    label({ type: ComponentType.CheckboxGroup, customId: 'thg_survey:q2', values: q2 }),
    label({ type: ComponentType.RadioGroup, customId: 'thg_survey:q3', value: q3 }),
    label({ type: ComponentType.TextInput, customId: 'thg_survey:q4', value: q4 }),
  ];
}

// --- Configuration -----------------------------------------------------------
// THG's four questions, verbatim from their Google Form. `label.en` must stay
// exactly these strings — staff and THG surfaces render them.
const THG_QUESTIONS_EN = [
  'Which types of games do you mainly play?',
  'Have you ever done any of the following?',
  'If you were invited to a free workshop on Gaming and Cybersecurity in October, would you be interested?',
  "Where can we reach you if you're shortlisted for the workshop?",
];

test("the four English questions match THG's source form verbatim", () => {
  assert.deepEqual(
    THG_SURVEY.questions.map((question) => question.label.en),
    THG_QUESTIONS_EN,
  );
  assert.deepEqual(
    surveyQuestion('q3').options.map((option) => option.label.en),
    ['Yes, and I confirm I am 18 or over', 'Maybe', 'No'],
  );
  assert.equal(surveyQuestion('q1').options.length, 8);
  assert.equal(surveyQuestion('q2').options.at(-1).label.en, 'None of these (yet)');
});

test('survey definition is exactly the four THG questions with unique, bilingual ids', () => {
  assert.deepEqual(validateSurveyDefinition(), []);
  assert.equal(THG_SURVEY.questions.length, 4);
  assert.deepEqual(
    THG_SURVEY.questions.map((question) => question.id),
    ['q1', 'q2', 'q3', 'q4'],
  );
  assert.equal(new Set(THG_SURVEY.questions.map((question) => question.customId)).size, 4);
  for (const question of THG_SURVEY.questions) {
    assert.ok(question.label.ar && question.label.en, `${question.id} needs both labels`);
    for (const option of question.options || []) {
      assert.ok(option.label.ar && option.label.en, `${question.id}/${option.value} needs both labels`);
      assert.match(option.value, /^[a-z0-9_]+$/, 'canonical values stay language-neutral');
    }
  }
});

test('every question stays inside the Discord component limits', () => {
  assert.ok(THG_SURVEY.modalTitle.ar.length <= DISCORD_LIMITS.modalTitle);
  // The intro Text Display takes one of the five top-level modal slots.
  assert.ok(THG_SURVEY.questions.length + 1 <= DISCORD_LIMITS.modalComponents);
  for (const question of THG_SURVEY.questions) {
    assert.ok(question.label.ar.length <= DISCORD_LIMITS.labelText, `${question.id} label`);
    assert.ok((question.description?.ar || '').length <= DISCORD_LIMITS.labelDescription, `${question.id} description`);
    assert.ok(question.customId.length <= DISCORD_LIMITS.customId);
    if (question.type === 'radio_group') {
      assert.ok(question.options.length >= DISCORD_LIMITS.radioGroupOptions.min);
      assert.ok(question.options.length <= DISCORD_LIMITS.radioGroupOptions.max);
    }
    if (question.type === 'checkbox_group') {
      assert.ok(question.options.length <= DISCORD_LIMITS.checkboxGroupOptions.max);
      assert.ok(question.maxValues <= question.options.length);
      assert.ok(question.minValues >= 1, 'a required checkbox group needs min_values >= 1');
    }
    for (const option of question.options || []) {
      assert.ok(option.label.ar.length <= DISCORD_LIMITS.optionLabel);
      assert.ok(option.value.length <= DISCORD_LIMITS.optionValue);
    }
  }
});

test('definition validator reports limit breaches instead of failing at Discord', () => {
  const broken = {
    ...THG_SURVEY,
    modalTitle: { ar: 'ا'.repeat(46) },
    questions: [
      { ...THG_SURVEY.questions[0], label: { ar: 'ب'.repeat(46), en: 'x' } },
      { ...THG_SURVEY.questions[2], options: [THG_SURVEY.questions[2].options[0]] },
    ],
  };
  const problems = validateSurveyDefinition(broken);
  assert.ok(problems.some((p) => /modal title exceeds/.test(p)));
  assert.ok(problems.some((p) => /Arabic label exceeds/.test(p)));
  assert.ok(problems.some((p) => /options \(allowed 2-10\)/.test(p)));
});

// --- Submission parsing ------------------------------------------------------
test('parses radio group, checkbox group and text input out of Label wrappers', () => {
  const parsed = parseSurveySubmission(
    submission({ q1: ['moba', 'fps'], q2: ['mods', 'code_scripts'], q3: 'yes_18_plus', q4: '  me@example.com  ' }),
  );
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.errors, []);
  // Selections are re-ordered into definition order so exports stay comparable.
  assert.deepEqual(parsed.answers.q1, ['fps', 'moba']);
  assert.deepEqual(parsed.answers.q2, ['code_scripts', 'mods']);
  assert.equal(parsed.answers.q3, 'yes_18_plus');
  assert.equal(parsed.answers.q4, 'me@example.com');
});

test('optional free text may be empty', () => {
  const parsed = parseSurveySubmission(submission({ q4: '' }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.answers.q4, '');
});

test('missing required answers are rejected, not silently stored', () => {
  const empty = parseSurveySubmission(submission({ q1: [], q3: null }));
  assert.equal(empty.ok, false);
  assert.ok(empty.errors.includes('q1: required'));
  assert.ok(empty.errors.includes('q3: required'));

  const absent = parseSurveySubmission([
    {
      type: ComponentType.Label,
      component: { type: ComponentType.RadioGroup, customId: 'thg_survey:q3', value: 'no' },
    },
  ]);
  assert.equal(absent.ok, false);
  assert.ok(absent.errors.includes('q1: missing'));
  assert.equal(absent.answers.q3, 'no', 'the answers that did arrive are kept');
});

test('values outside the definition are dropped and flagged', () => {
  const spoofed = parseSurveySubmission(submission({ q1: ['fps', 'not_a_real_option'], q3: 'not_an_option' }));
  assert.equal(spoofed.ok, false);
  assert.deepEqual(spoofed.answers.q1, ['fps']);
  assert.equal(spoofed.answers.q3, null);
  assert.ok(spoofed.errors.some((error) => /q1: unknown option/.test(error)));
  assert.ok(spoofed.errors.some((error) => /q3: unknown option/.test(error)));
});

test('a repeated selection is not mistaken for an unknown option', () => {
  const parsed = parseSurveySubmission(submission({ q1: ['fps', 'fps'] }));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.answers.q1, ['fps']);
});

test('malformed payloads fail closed instead of throwing', () => {
  for (const payload of [null, undefined, 'nope', [null], [{ type: 18 }], [{ type: 18, component: null }]]) {
    const parsed = parseSurveySubmission(payload);
    assert.equal(parsed.ok, false, `payload ${JSON.stringify(payload)} must not pass`);
    assert.deepEqual(parsed.answers.q1, []);
  }
});

test('a legacy action-row payload is still parsed rather than lost', () => {
  const parsed = parseSurveySubmission([
    {
      type: ComponentType.ActionRow,
      components: [{ type: ComponentType.TextInput, customId: 'thg_survey:q4', value: 'x@y.z' }],
    },
  ]);
  assert.equal(parsed.answers.q4, 'x@y.z');
});

test('free text is normalized and capped at the definition length', () => {
  const parsed = parseSurveySubmission(submission({ q4: `a\n\n  b   ${'c'.repeat(400)}` }));
  assert.equal(parsed.answers.q4.length, surveyQuestion('q4').maxLength);
  assert.ok(parsed.answers.q4.startsWith('a b '));
});

// --- Arabic <-> English mapping ---------------------------------------------
test('one canonical value renders Arabic for members and English for THG', () => {
  const q1 = surveyQuestion('q1');
  assert.equal(renderAnswer(q1, ['fps'], 'ar'), 'تصويب FPS (فالورانت، CS، رينبو سكس)');
  assert.equal(renderAnswer(q1, ['fps'], 'en'), 'FPS (e.g., Valorant, CSGO, Rainbow Six)');
  assert.equal(
    renderAnswer(surveyQuestion('q2'), ['mods', 'server_admin'], 'en'),
    'Made mods or custom content, Run or helped admin a game server or online community',
  );
  assert.equal(renderAnswer(surveyQuestion('q3'), 'maybe', 'ar'), 'ممكن');
  assert.equal(renderAnswer(surveyQuestion('q3'), 'maybe', 'en'), 'Maybe');
});

// --- Aggregation -------------------------------------------------------------
const RESPONSES = [
  {
    submittedAt: 1_760_000_000,
    surveyVersion: THG_SURVEY.version,
    answers: { q1: ['fps', 'moba'], q2: ['mods'], q3: 'maybe', q4: '' },
  },
  {
    submittedAt: 1_760_000_100,
    surveyVersion: THG_SURVEY.version,
    answers: { q1: ['fps'], q2: ['mods', 'none_yet'], q3: 'maybe', q4: 'me@example.com' },
  },
  {
    submittedAt: 1_760_000_200,
    surveyVersion: THG_SURVEY.version,
    answers: { q1: ['rpg'], q2: ['code_scripts'], q3: 'no', q4: '' },
  },
  {
    submittedAt: 1_760_000_300,
    surveyVersion: THG_SURVEY.version,
    answers: { q1: ['fps'], q2: ['mods'], q3: 'yes_18_plus', q4: '' },
  },
];

test('single-choice aggregation counts and percentages are of all responses', () => {
  const summary = aggregateResponses(RESPONSES);
  assert.equal(summary.total, 4);
  const q3 = summary.questions.find((question) => question.id === 'q3');
  const byValue = Object.fromEntries(q3.options.map((option) => [option.value, option]));
  assert.equal(byValue.maybe.count, 2);
  assert.equal(byValue.maybe.percent, 50);
  assert.equal(byValue.no.count, 1);
  assert.equal(byValue.no.percent, 25);
  assert.equal(byValue.yes_18_plus.count, 1);
  assert.equal(
    q3.question,
    'If you were invited to a free workshop on Gaming and Cybersecurity in October, would you be interested?',
  );
});

test('multi-choice aggregation counts every selection and reports respondents', () => {
  const summary = aggregateResponses(RESPONSES);
  const q1 = summary.questions.find((question) => question.id === 'q1');
  const byValue = Object.fromEntries(q1.options.map((option) => [option.value, option]));
  assert.equal(q1.responders, 4);
  assert.equal(byValue.fps.count, 3);
  assert.equal(byValue.fps.percent, 75);
  assert.equal(byValue.moba.count, 1);
  assert.equal(byValue.moba.percent, 25);
  assert.equal(byValue.fighting.count, 0);
  assert.equal(byValue.fighting.percent, 0);
});

test('free-text aggregation reports counts only and never the answers', () => {
  const summary = aggregateResponses(RESPONSES);
  const q4 = summary.questions.find((question) => question.id === 'q4');
  assert.equal(q4.answered, 1);
  assert.equal(q4.answeredPercent, 25);
  assert.equal(q4.sensitive, true);
  assert.ok(!JSON.stringify(summary).includes('me@example.com'));
});

test('aggregation of an empty set does not divide by zero', () => {
  const summary = aggregateResponses([]);
  assert.equal(summary.total, 0);
  for (const question of summary.questions) {
    for (const option of question.options || []) assert.equal(option.percent, 0);
  }
});

test('aggregate results carry no respondent identifier', () => {
  const rows = RESPONSES.map((response, index) => ({
    ...response,
    id: index,
    guildId: '111111111111111111',
    respondentHash: 'deadbeefdeadbeef',
  }));
  const serialized = JSON.stringify(aggregateResponses(rows));
  assert.ok(!serialized.includes('deadbeefdeadbeef'));
  assert.ok(!serialized.includes('111111111111111111'));
});

// --- CSV ---------------------------------------------------------------------
test('CSV carries answers only — no guild, hash, or Discord identity', () => {
  const csv = responsesToCsv(
    RESPONSES.map((response) => ({ ...response, guildId: '111111111111111111', respondentHash: 'abc123' })),
  );
  const [header, questionRow, ...rows] = csv.trim().split('\n');
  assert.equal(header, 'submitted_at,survey_version,q1,q2,q3,q4');
  assert.ok(questionRow.includes('Which types of games do you mainly play?'));
  assert.equal(rows.length, 4);
  assert.ok(!csv.includes('abc123'));
  assert.ok(!csv.includes('111111111111111111'));
  assert.ok(!/respondent_hash|guild_id|user_id/.test(csv));
});

test('CSV joins multi-select answers with a deterministic separator', () => {
  const csv = responsesToCsv([RESPONSES[0]]);
  const row = csv.trim().split('\n')[2];
  const joined =
    `FPS (e.g., Valorant, CSGO, Rainbow Six)${CSV_MULTI_SELECT_SEPARATOR}` +
    'MOBA (e.g., League of Legends, Dota 2)';
  assert.ok(row.includes(joined), `unexpected multi-select cell in ${row}`);
  assert.ok(row.startsWith('2025-10-09'), `unexpected timestamp in ${row}`);
});

test('CSV quotes separators and neutralizes spreadsheet formulas in free text', () => {
  const csv = responsesToCsv([
    { ...RESPONSES[0], answers: { ...RESPONSES[0].answers, q4: '=HYPERLINK("http://x"),"y"' } },
  ]);
  const row = csv.trim().split('\n')[2];
  assert.ok(row.includes(`"'=HYPERLINK(""http://x""),""y"""`), `unexpected cell in ${row}`);
});

// --- De-duplication key ------------------------------------------------------
test('respondent hash is stable per member, distinct per member/guild, and needs a secret', () => {
  const a = respondentHash('secret', 'guild-1', 'user-1');
  assert.equal(a, respondentHash('secret', 'guild-1', 'user-1'));
  assert.notEqual(a, respondentHash('secret', 'guild-1', 'user-2'));
  assert.notEqual(a, respondentHash('secret', 'guild-2', 'user-1'));
  assert.notEqual(a, respondentHash('other-secret', 'guild-1', 'user-1'));
  assert.ok(!a.includes('user-1'), 'the raw user id is not recoverable from the stored value');
  assert.throws(() => respondentHash('', 'guild-1', 'user-1'), /SURVEY_HASH_SECRET/);
});

// --- Discord surfaces --------------------------------------------------------
test('the announcement is a Components V2 container with the Arabic CTA button', () => {
  const payload = buildSurveyAnnouncement();
  assert.ok(!('content' in payload) && !('embeds' in payload), 'Components V2 messages carry text in components');
  const container = payload.components[0].toJSON();
  assert.equal(container.type, ComponentType.Container);
  const texts = container.components.filter((c) => c.type === ComponentType.TextDisplay).map((c) => c.content);
  assert.ok(texts[0].includes(THG_SURVEY.title.ar));
  assert.ok(texts.some((text) => text.includes('The Hacking Games')));
  assert.ok(texts.some((text) => text.includes(THG_SURVEY.privacyNotice.ar)), 'privacy notice is visible up front');
  // The card asks for opinions; it must not read as a workshop ad (no date, no
  // limited places, no "register now" / "get selected").
  const body = texts.join('\n');
  assert.ok(!/أكتوبر|مقاعد|سجل الآن|التسجيل مفتوح|يتم اختيار/.test(body), 'the card must not advertise the workshop');
  assert.ok(body.includes('وليس التسجيل في ورشة أو برنامج'), 'the card says outright it is not a sign-up');
  const button = container.components.find((c) => c.type === ComponentType.ActionRow).components[0];
  assert.equal(button.custom_id, 'thg_survey:start');
  assert.equal(button.style, 1);
  assert.equal(button.label, 'شارك في الاستبيان');
});

test('the modal uses Label-wrapped inputs, never legacy action rows', () => {
  const modal = buildSurveyModal().toJSON();
  assert.equal(modal.custom_id, 'thg_survey:submit');
  assert.ok(modal.title.length <= DISCORD_LIMITS.modalTitle);
  assert.equal(modal.components.length, 5);
  assert.equal(modal.components[0].type, ComponentType.TextDisplay);
  assert.ok(modal.components[0].content.includes(THG_SURVEY.privacyNotice.ar));
  assert.ok(!modal.components.some((component) => component.type === ComponentType.ActionRow));

  const labels = modal.components.slice(1);
  assert.deepEqual(
    labels.map((label) => label.component.type),
    [ComponentType.CheckboxGroup, ComponentType.CheckboxGroup, ComponentType.RadioGroup, ComponentType.TextInput],
  );
  assert.deepEqual(
    labels.map((label) => label.component.custom_id),
    ['thg_survey:q1', 'thg_survey:q2', 'thg_survey:q3', 'thg_survey:q4'],
  );
  for (const label of labels) assert.equal(label.type, ComponentType.Label);

  const [q1, , q3, q4] = labels;
  assert.equal(q1.component.min_values, 1);
  assert.equal(q1.component.max_values, 8);
  assert.equal(q1.component.required, true);
  assert.equal(q3.component.required, true);
  assert.equal(q4.component.required, false);
  // Members read Arabic; canonical values stay language-neutral.
  assert.equal(q1.component.options[0].label, 'تصويب FPS (فالورانت، CS، رينبو سكس)');
  assert.equal(q1.component.options[0].value, 'fps');
});

// --- English notification embeds --------------------------------------------
const STORED = {
  id: 7,
  responseNumber: 12,
  surveyVersion: THG_SURVEY.version,
  submittedAt: 1_760_000_000,
  guildId: '111111111111111111',
  respondentHash: 'deadbeefdeadbeef',
  answers: { q1: ['fps', 'moba'], q2: ['mods'], q3: 'yes_18_plus', q4: 'me@example.com' },
};

test('log and THG embeds are English and carry no respondent identity', () => {
  for (const embed of [buildLogEmbed(STORED).toJSON(), buildThgEmbed(STORED).toJSON()]) {
    const serialized = JSON.stringify(embed);
    assert.ok(!serialized.includes('deadbeefdeadbeef'), 'the respondent hash must never leave the database');
    assert.ok(!serialized.includes('111111111111111111'));
    assert.ok(serialized.includes('Which types of games do you mainly play?'));
    assert.ok(serialized.includes('FPS (e.g., Valorant, CSGO, Rainbow Six)'));
    assert.ok(serialized.includes('Made mods or custom content'));
    assert.ok(serialized.includes('Yes, and I confirm I am 18 or over'));
    assert.ok(!/[؀-ۿ]/.test(serialized), 'staff-facing embeds render English, not the Arabic labels');
    assert.equal(embed.fields.find((field) => field.name === 'Survey Version').value, THG_SURVEY.version);
    assert.equal(embed.fields.find((field) => field.name === 'Response Number').value, '#12');
  }
  assert.equal(buildLogEmbed(STORED).toJSON().title, 'New THG Gamer Survey Response');
  assert.equal(buildThgEmbed(STORED).toJSON().title, 'New Saudi Gamer Survey Response');
});

test('free text is preserved verbatim and marked untranslated', () => {
  const embed = buildThgEmbed(STORED).toJSON();
  const q4 = embed.fields[3];
  assert.ok(q4.value.includes('Original response (not translated)'));
  assert.ok(q4.value.includes('me@example.com'));
});

test('an oversized free-text answer is truncated for the embed, not dropped', () => {
  const embed = buildThgEmbed({ ...STORED, answers: { ...STORED.answers, q4: 'x'.repeat(4000) } }).toJSON();
  for (const field of embed.fields) assert.ok(field.value.length <= 1024, `${field.name} exceeds the embed limit`);
  assert.ok(embed.fields[3].value.endsWith('…'));
});

test('a blank optional answer renders a placeholder rather than an empty field', () => {
  const embed = buildThgEmbed({ ...STORED, answers: { ...STORED.answers, q4: '' } }).toJSON();
  assert.equal(embed.fields[3].value, '—');
});
