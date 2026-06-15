// Helpers for turning CMS markdown into Discord-friendly embed text.
//
// Discord embed descriptions render a useful subset of markdown — bold, italic,
// `code`, > quotes, - lists, # headings, and [masked](links) — but NOT inline
// images, so we strip image syntax and bare HTML, then cap to Discord's limit at
// a clean boundary instead of mid-word. Pure functions so they are unit-tested
// without a Discord client (tests/discordContent.test.mjs).

export const DISCORD_DESCRIPTION_CAP = 4096;
export const DISCORD_TITLE_CAP = 256;
export const DISCORD_AUTHOR_CAP = 256;
export const DISCORD_FOOTER_CAP = 2048;

export function clampText(value, max) {
  const text = typeof value === 'string' ? value : '';
  return text.length > max ? text.slice(0, max) : text;
}

// Remove markdown that Discord cannot render inline so it does not show as raw
// syntax. Cover/thumbnail images are handled separately via setImage/setThumbnail.
export function stripUnsupportedMarkdown(markdown) {
  if (typeof markdown !== 'string') return '';
  return markdown
    // ![alt](url) and ![alt](url "title") image embeds -> drop entirely.
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    // Stray HTML tags occasionally pasted into the body.
    .replace(/<\/?[a-z][^>]*>/gi, '')
    // Collapse the blank lines left behind so paragraphs stay tight.
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Truncate to `cap` characters, preferring a paragraph -> sentence -> word
// boundary in the last ~40% so the cut reads cleanly, with an ellipsis appended.
export function truncateForDiscord(text, cap = DISCORD_DESCRIPTION_CAP) {
  const value = typeof text === 'string' ? text : '';
  if (value.length <= cap) return value;
  const slice = value.slice(0, cap - 1);
  const floor = Math.floor(cap * 0.6);
  const byParagraph = slice.lastIndexOf('\n\n');
  const bySentence = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('.\n'));
  const byWord = slice.lastIndexOf(' ');
  let cut = slice.length;
  if (byParagraph >= floor) cut = byParagraph;
  else if (bySentence >= floor) cut = bySentence + 1;
  else if (byWord >= floor) cut = byWord;
  return `${slice.slice(0, cut).trimEnd()}…`;
}

// Full pipeline: clean CMS markdown and cap it for an embed description.
export function prepareBodyForDiscord(markdown, cap = DISCORD_DESCRIPTION_CAP) {
  return truncateForDiscord(stripUnsupportedMarkdown(markdown), cap);
}
