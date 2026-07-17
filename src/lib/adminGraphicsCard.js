import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import { loadLogoImage } from './logoCache.js';

function registerFont(paths, family) {
  for (const path of paths) {
    try {
      GlobalFonts.registerFromPath(path, family);
      return family;
    } catch {
      // Try the next platform font path.
    }
  }
  return null;
}

function registerFontFamily(paths, family) {
  let registered = false;
  for (const path of paths) {
    try {
      GlobalFonts.registerFromPath(path, family);
      registered = true;
    } catch {
      // Optional platform fallback.
    }
  }
  return registered ? family : null;
}

function bundledFontPaths(fileName) {
  return [
    resolve(process.cwd(), 'src/assets/fonts', fileName),
    resolve(process.cwd(), '../../src/assets/fonts', fileName),
  ];
}

const THMANYAH_REGULAR = bundledFontPaths('thmanyahsans-Regular.otf');
const THMANYAH_BOLD = bundledFontPaths('thmanyahsans-Bold.otf');

const HEAD = registerFont(
  [
    ...THMANYAH_BOLD,
    'C:/Windows/Fonts/segoeuib.ttf',
    'C:/Windows/Fonts/arialbd.ttf',
    '/usr/share/fonts/opentype/inter/Inter-Bold.otf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  ],
  'AdminGraphicsHeading',
) || 'sans-serif';
const BODY = registerFont(
  [
    ...THMANYAH_REGULAR,
    'C:/Windows/Fonts/segoeui.ttf',
    'C:/Windows/Fonts/arial.ttf',
    '/usr/share/fonts/opentype/inter/Inter-Regular.otf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  ],
  'AdminGraphicsBody',
) || 'sans-serif';
// Use one face that covers both Arabic and Latin. Canvas font fallback is not
// reliable inside a mixed-direction run, so an Arabic-only Noto face can turn
// embedded English names into missing-glyph boxes.
const ARABIC = registerFontFamily(
  [
    ...THMANYAH_REGULAR,
    ...THMANYAH_BOLD,
    'C:/Windows/Fonts/tahoma.ttf',
    'C:/Windows/Fonts/segoeui.ttf',
    'C:/Windows/Fonts/arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansArabic-Regular.ttf',
  ],
  'AdminGraphicsUniversal',
) || BODY;

const WIDTH = 1600;
const HEIGHT = 900;
const COLORS = {
  background: '#080d16',
  surface: '#101722',
  surfaceRaised: '#151e2b',
  row: '#121b28',
  border: '#293446',
  borderSoft: '#202a39',
  primary: '#4381ff',
  primarySoft: '#16284a',
  text: '#f4f7fb',
  muted: '#9aabc0',
  subtle: '#718096',
};

function quoteFamily(family) {
  return /\s/.test(family) ? `"${family}"` : family;
}

function cleanText(value, fallback, maxLength = 160) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
  return text || fallback;
}

function hasArabic(value) {
  return /\p{Script=Arabic}/u.test(String(value ?? ''));
}

function fontFor(value, size, bold = false) {
  const family = hasArabic(value)
    ? `${quoteFamily(ARABIC)}, ${quoteFamily(bold ? HEAD : BODY)}`
    : quoteFamily(bold ? HEAD : BODY);
  return `${bold ? 'bold ' : ''}${size}px ${family}`;
}

function prepareText(ctx, value, { size, bold = false, align = 'left', color = COLORS.text } = {}) {
  const rtl = hasArabic(value);
  ctx.font = fontFor(value, size, bold);
  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.textAlign = rtl && align === 'left' ? 'right' : align;
  ctx.fillStyle = color;
}

function fitText(ctx, value, maxWidth, options) {
  let text = cleanText(value, '', 240);
  prepareText(ctx, text, options);
  if (ctx.measureText(text).width <= maxWidth) return text;
  const chars = Array.from(text);
  while (chars.length > 1) {
    chars.pop();
    text = `${chars.join('')}…`;
    if (ctx.measureText(text).width <= maxWidth) return text;
  }
  return '…';
}

function drawText(ctx, value, x, y, maxWidth, options) {
  const text = fitText(ctx, value, maxWidth, options);
  prepareText(ctx, text, options);
  ctx.fillText(text, x, y);
}

function wrapLines(ctx, value, maxWidth, options, maxLines) {
  const words = cleanText(value, '', 300).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    prepareText(ctx, next, options);
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    } else {
      line = next;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.map((candidate, index) => (
    index === maxLines - 1 ? fitText(ctx, candidate, maxWidth, options) : candidate
  ));
}

function roundRect(ctx, x, y, width, height, radius = 16) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function fillRoundRect(ctx, x, y, width, height, radius, color, stroke = null) {
  roundRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = color;
  ctx.fill();
  if (stroke) {
    roundRect(ctx, x, y, width, height, radius);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function initials(value) {
  return cleanText(value, '?', 60)
    .split(/\s+/)
    .map((part) => Array.from(part)[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();
}

function drawLogo(ctx, image, name, cx, cy, size) {
  if (image) {
    const scale = Math.min(size / image.width, size / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    ctx.save();
    ctx.shadowColor = 'rgba(255,255,255,0.24)';
    ctx.shadowBlur = 12;
    ctx.drawImage(image, cx - width / 2, cy - height / 2, width, height);
    ctx.restore();
    return;
  }
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.primarySoft;
  ctx.fill();
  ctx.strokeStyle = '#31548f';
  ctx.lineWidth = 2;
  ctx.stroke();
  drawText(ctx, initials(name), cx, cy + size * 0.1, size * 0.62, {
    size: Math.round(size * 0.28),
    bold: true,
    align: 'center',
    color: '#a9c7ff',
  });
}

function createBase(label) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  fillRoundRect(ctx, 52, 42, WIDTH - 104, HEIGHT - 84, 24, COLORS.surface, COLORS.border);
  ctx.fillStyle = COLORS.primary;
  ctx.fillRect(52, 42, 8, HEIGHT - 84);

  fillRoundRect(ctx, 92, 78, 56, 56, 13, COLORS.primarySoft, '#31548f');
  drawText(ctx, 'EC', 120, 116, 44, { size: 23, bold: true, align: 'center', color: '#a9c7ff' });
  drawText(ctx, 'Esports Community', 168, 116, 500, { size: 28, bold: true });
  drawText(ctx, label, WIDTH - 94, 114, 320, { size: 20, bold: true, align: 'right', color: COLORS.muted });
  ctx.strokeStyle = COLORS.borderSoft;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(92, 160);
  ctx.lineTo(WIDTH - 92, 160);
  ctx.stroke();
  return { canvas, ctx };
}

function drawTeamPanel(ctx, { x, name, image }) {
  fillRoundRect(ctx, x, 350, 520, 350, 20, COLORS.surfaceRaised, COLORS.borderSoft);
  drawLogo(ctx, image, name, x + 260, 492, 150);
  drawText(ctx, name, x + 260, 638, 420, {
    size: 38,
    bold: true,
    align: 'center',
  });
}

async function renderMatchResult(input) {
  const { canvas, ctx } = createBase('MATCH RESULT');
  const [logoA, logoB] = await Promise.all([
    loadLogoImage(input.logoA),
    loadLogoImage(input.logoB),
  ]);
  const tournament = cleanText(input.tournament, 'Tournament', 100);
  const rtl = hasArabic(tournament);
  drawText(ctx, tournament, rtl ? WIDTH - 92 : 92, 244, 1260, {
    size: 54,
    bold: true,
    align: rtl ? 'right' : 'left',
  });
  drawText(ctx, cleanText(input.game, 'Esports', 80), rtl ? WIDTH - 92 : 92, 292, 600, {
    size: 25,
    align: rtl ? 'right' : 'left',
    color: COLORS.muted,
  });

  drawTeamPanel(ctx, { x: 92, name: input.teamA, image: logoA });
  drawTeamPanel(ctx, { x: 988, name: input.teamB, image: logoB });
  fillRoundRect(ctx, 655, 432, 290, 186, 20, COLORS.background, '#31548f');
  drawText(ctx, `${Number(input.scoreA)} : ${Number(input.scoreB)}`, WIDTH / 2, 552, 250, {
    size: 82,
    bold: true,
    align: 'center',
  });
  drawText(ctx, 'FINAL', WIDTH / 2, 598, 180, { size: 19, bold: true, align: 'center', color: COLORS.primary });
  drawText(ctx, 'esportscommunity.net', WIDTH - 94, 784, 360, { size: 20, align: 'right', color: COLORS.subtle });
  return canvas.toBuffer('image/png');
}

async function renderStandings(input) {
  const { canvas, ctx } = createBase('STANDINGS');
  const tournament = cleanText(input.tournament, 'Tournament', 100);
  const rtl = hasArabic(tournament);
  drawText(ctx, tournament, rtl ? WIDTH - 92 : 92, 230, 1180, {
    size: 47,
    bold: true,
    align: rtl ? 'right' : 'left',
  });
  drawText(ctx, input.section, rtl ? WIDTH - 92 : 92, 274, 900, {
    size: 24,
    align: rtl ? 'right' : 'left',
    color: COLORS.muted,
  });

  const entries = Array.isArray(input.entries) ? input.entries.slice(0, 6) : [];
  const logos = await Promise.all(entries.map((entry) => loadLogoImage(entry.logo)));
  entries.forEach((entry, index) => {
    const y = 314 + index * 76;
    fillRoundRect(ctx, 92, y, WIDTH - 184, 62, 12, index === 0 ? COLORS.primarySoft : COLORS.row, index === 0 ? '#31548f' : COLORS.borderSoft);
    const rankColor = index < 3 ? '#a9c7ff' : COLORS.muted;
    drawText(ctx, String(Number(entry.rank) || index + 1), 130, y + 41, 52, { size: 25, bold: true, color: rankColor });
    drawLogo(ctx, logos[index], entry.team, 202, y + 31, 40);
    const teamRtl = hasArabic(entry.team);
    drawText(ctx, entry.team, teamRtl ? 1080 : 244, y + 41, 820, {
      size: 27,
      bold: true,
      align: teamRtl ? 'right' : 'left',
    });
    drawText(ctx, entry.points || entry.extra || '-', WIDTH - 126, y + 41, 240, {
      size: 25,
      bold: true,
      align: 'right',
      color: index === 0 ? '#a9c7ff' : COLORS.text,
    });
  });
  drawText(ctx, 'esportscommunity.net', WIDTH - 94, 800, 360, { size: 20, align: 'right', color: COLORS.subtle });
  return canvas.toBuffer('image/png');
}

function renderNewsPromo(input) {
  const { canvas, ctx } = createBase('NEWS');
  const owner = cleanText(input.owner, 'Community', 80);
  fillRoundRect(ctx, 92, 204, 250, 42, 12, COLORS.primarySoft, '#31548f');
  drawText(ctx, owner, 217, 233, 210, { size: 19, bold: true, align: 'center', color: '#a9c7ff' });

  const title = cleanText(input.title, 'Community update', 180);
  const rtl = hasArabic(title);
  const titleLines = wrapLines(ctx, title, 1320, { size: 64, bold: true }, 3);
  const titleX = rtl ? WIDTH - 92 : 92;
  titleLines.forEach((line, index) => {
    drawText(ctx, line, titleX, 350 + index * 82, 1320, {
      size: 64,
      bold: true,
      align: rtl ? 'right' : 'left',
    });
  });

  const summary = cleanText(input.summary, '', 260);
  if (summary) {
    const summaryRtl = hasArabic(summary);
    const summaryLines = wrapLines(ctx, summary, 1260, { size: 30 }, 2);
    summaryLines.forEach((line, index) => {
      drawText(ctx, line, summaryRtl ? WIDTH - 92 : 92, 670 + index * 45, 1260, {
        size: 30,
        align: summaryRtl ? 'right' : 'left',
        color: COLORS.muted,
      });
    });
  }
  drawText(ctx, 'Read more at esportscommunity.net', rtl ? WIDTH - 92 : 92, 790, 600, {
    size: 22,
    bold: true,
    align: rtl ? 'right' : 'left',
    color: COLORS.primary,
  });
  return canvas.toBuffer('image/png');
}

export async function renderAdminGraphic(input) {
  switch (input?.template) {
    case 'match-result':
      return renderMatchResult(input);
    case 'standings':
      return renderStandings(input);
    case 'news-promo':
      return renderNewsPromo(input);
    default:
      throw new TypeError('Unknown admin graphics template.');
  }
}
