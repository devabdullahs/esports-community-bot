import {
  ButtonBuilder,
  ButtonStyle,
  CheckboxGroupBuilder,
  CheckboxGroupOptionBuilder,
  ContainerBuilder,
  EmbedBuilder,
  LabelBuilder,
  ModalBuilder,
  RadioGroupBuilder,
  RadioGroupOptionBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { DISCORD_LIMITS, renderAnswer, THG_SURVEY } from './thgSurvey.js';

// Discord surfaces for the THG survey. Member-facing surfaces render `ar`;
// staff/THG surfaces render `en` (see src/lib/thgSurvey.js for the pairing).
//
// The modal uses the CURRENT modal component model — a Label (type 18) wrapping
// a Radio Group / Checkbox Group / Text Input — not the deprecated
// ActionRow -> TextInput shape. discord.js 14.26 exposes builders for all of
// these, so no raw API payloads are needed.

// Royal Azure, matching the dashboard palette. The test embed stays grey so a
// configuration probe can never be mistaken for a real response.
const SURVEY_ACCENT = 0x2563eb;
const TEST_ACCENT = 0x9ca3af;

export const SURVEY_START_CUSTOM_ID = 'thg_survey:start';
export const SURVEY_MODAL_CUSTOM_ID = 'thg_survey:submit';

// Discord embed limits. Field values are the only place a free-text answer can
// overflow, so it is truncated for DISPLAY while the database keeps the original.
const EMBED_FIELD_VALUE_CAP = 1024;
const EMBED_FIELD_NAME_CAP = 256;

function cap(text, max) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Public Components V2 announcement card (Arabic). */
export function buildSurveyAnnouncement(survey = THG_SURVEY) {
  const container = new ContainerBuilder()
    .setAccentColor(SURVEY_ACCENT)
    .addTextDisplayComponents((display) => display.setContent(`## ${survey.title.ar}`))
    .addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents((display) => display.setContent(survey.announcement.ar))
    .addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents((display) => display.setContent(`-# ${survey.privacyNotice.ar}`))
    .addActionRowComponents((row) =>
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(SURVEY_START_CUSTOM_ID)
          .setStyle(ButtonStyle.Primary)
          .setLabel(survey.cta.ar),
      ),
    );

  // A Components V2 message carries its text INSIDE the components; mixing in
  // content/embeds is rejected by Discord.
  return { components: [container] };
}

function buildQuestionLabel(question) {
  const label = new LabelBuilder()
    .setLabel(cap(question.label.ar, DISCORD_LIMITS.labelText))
    .setDescription(cap(question.description?.ar || '', DISCORD_LIMITS.labelDescription));

  if (question.type === 'radio_group') {
    return label.setRadioGroupComponent(
      new RadioGroupBuilder()
        .setCustomId(question.customId)
        .setRequired(Boolean(question.required))
        .setOptions(
          question.options.map((option) =>
            new RadioGroupOptionBuilder()
              .setLabel(cap(option.label.ar, DISCORD_LIMITS.optionLabel))
              .setValue(option.value),
          ),
        ),
    );
  }

  if (question.type === 'checkbox_group') {
    return label.setCheckboxGroupComponent(
      new CheckboxGroupBuilder()
        .setCustomId(question.customId)
        .setRequired(Boolean(question.required))
        .setMinValues(question.required ? question.minValues || 1 : 0)
        .setMaxValues(Math.min(question.maxValues || question.options.length, question.options.length))
        .setOptions(
          question.options.map((option) =>
            new CheckboxGroupOptionBuilder()
              .setLabel(cap(option.label.ar, DISCORD_LIMITS.optionLabel))
              .setValue(option.value),
          ),
        ),
    );
  }

  const input = new TextInputBuilder()
    .setCustomId(question.customId)
    .setStyle(TextInputStyle.Short)
    .setRequired(Boolean(question.required))
    .setMaxLength(question.maxLength || 200);
  if (question.placeholder?.ar) input.setPlaceholder(cap(question.placeholder.ar, 100));
  return label.setTextInputComponent(input);
}

/** The member-facing survey modal (Arabic). */
export function buildSurveyModal(survey = THG_SURVEY) {
  const modal = new ModalBuilder()
    .setCustomId(SURVEY_MODAL_CUSTOM_ID)
    .setTitle(cap(survey.modalTitle.ar, DISCORD_LIMITS.modalTitle));

  // Intro + privacy notice occupy the first of the modal's five top-level slots.
  modal.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`${survey.intro.ar}\n${survey.privacyNotice.ar}`),
  );
  modal.addLabelComponents(survey.questions.map((question) => buildQuestionLabel(question)));
  return modal;
}

function answerFields(response, survey) {
  return survey.questions.map((question, index) => {
    const rendered = renderAnswer(question, response.answers?.[question.id], 'en');
    const isFreeText = question.type === 'text';
    const value = rendered.trim()
      ? isFreeText
        ? `Original response (not translated):\n${rendered}`
        : rendered
      : '—';
    return {
      name: cap(`Question ${index + 1} — ${question.label.en}`, EMBED_FIELD_NAME_CAP),
      value: cap(value, EMBED_FIELD_VALUE_CAP),
      inline: false,
    };
  });
}

/**
 * English embed for a stored response. Used for BOTH the internal log channel
 * and the THG DM — neither carries any Discord identity, only the answers.
 */
function buildResponseEmbed(response, { title, description, survey = THG_SURVEY } = {}) {
  return new EmbedBuilder()
    .setColor(SURVEY_ACCENT)
    .setTitle(title)
    .setDescription(description)
    .addFields(...answerFields(response, survey))
    .addFields(
      { name: 'Survey Version', value: response.surveyVersion || survey.version, inline: true },
      { name: 'Response Number', value: `#${response.responseNumber}`, inline: true },
      {
        name: 'Submitted',
        value: `<t:${response.submittedAt}:f>`,
        inline: true,
      },
    );
}

export function buildLogEmbed(response, survey = THG_SURVEY) {
  return buildResponseEmbed(response, {
    title: 'New THG Gamer Survey Response',
    description: `A new response has been submitted to the ${survey.title.en}.`,
    survey,
  });
}

export function buildThgEmbed(response, survey = THG_SURVEY) {
  return buildResponseEmbed(response, {
    title: 'New Saudi Gamer Survey Response',
    description: `A new gamer has completed the ${survey.title.en}.`,
    survey,
  });
}

/** Clearly-marked configuration test embed — never shaped like a real response. */
export function buildNotificationTestEmbed({ requestedBy, survey = THG_SURVEY } = {}) {
  const embed = new EmbedBuilder()
    .setColor(TEST_ACCENT)
    .setTitle('THG Survey Notification Test')
    .setDescription('This is a test notification from Esports Community. No survey response was submitted.')
    .addFields({ name: 'Survey Version', value: survey.version, inline: true })
    .setTimestamp(new Date());
  if (requestedBy) {
    embed.addFields({ name: 'Requested By', value: cap(requestedBy, EMBED_FIELD_VALUE_CAP), inline: true });
  }
  return embed;
}
