import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import { loadLogoImage } from './logoCache.js';

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

const UNIVERSAL = registerFontFamily(
  [
    ...bundledFontPaths('thmanyahsans-Regular.otf'),
    ...bundledFontPaths('thmanyahsans-Bold.otf'),
    'C:/Windows/Fonts/segoeui.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  ],
  'AdminGraphicsUniversal',
) || 'sans-serif';

const FORMATS = {
  '16:9': { width: 1600, height: 900 },
  '1:1': { width: 1080, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '4:5': { width: 1080, height: 1350 },
};

const THEMES = {
  'ewc-teal': {
    background: '#06110f', surface: '#0a1a18', raised: '#0d2521', row: '#0b201d',
    border: '#1e4a43', softBorder: '#163a35', accent: '#2dd4bf', accentSoft: '#12332e',
    text: '#f7fffd', muted: '#90aaa5', subtle: '#66827d', onAccent: '#042f2e', light: false,
  },
  midnight: {
    background: '#080d1d', surface: '#0d1630', raised: '#142044', row: '#111c3b',
    border: '#29477e', softBorder: '#1d3563', accent: '#60a5fa', accentSoft: '#152d59',
    text: '#f8fbff', muted: '#9eb3d7', subtle: '#6f83aa', onAccent: '#071b36', light: false,
  },
  carbon: {
    background: '#09090b', surface: '#111113', raised: '#202024', row: '#18181b',
    border: '#3f3f46', softBorder: '#2b2b30', accent: '#e4e4e7', accentSoft: '#29292e',
    text: '#fafafa', muted: '#a1a1aa', subtle: '#71717a', onAccent: '#18181b', light: false,
  },
  slate: {
    background: '#101519', surface: '#1c2226', raised: '#293238', row: '#222b30',
    border: '#52616b', softBorder: '#3a474f', accent: '#67e8f9', accentSoft: '#193943',
    text: '#f8fafc', muted: '#a8b5bd', subtle: '#73838d', onAccent: '#083344', light: false,
  },
  light: {
    background: '#e9eceb', surface: '#ffffff', raised: '#f4f6f5', row: '#f7f8f8',
    border: '#b7c4c0', softBorder: '#d9e0de', accent: '#0f766e', accentSoft: '#d8f3ee',
    text: '#10201d', muted: '#526762', subtle: '#71837f', onAccent: '#ffffff', light: true,
  },
};

function cleanText(value, fallback, maxLength = 180) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
  return text || fallback;
}

function hasArabic(value) {
  return /\p{Script=Arabic}/u.test(String(value ?? ''));
}

function fontFor(size, bold = false) {
  return `${bold ? 'bold ' : ''}${Math.max(10, Math.round(size))}px "${UNIVERSAL}"`;
}

function prepareText(ctx, value, { size, bold = false, align = 'left', color } = {}) {
  ctx.font = fontFor(size, bold);
  ctx.direction = hasArabic(value) ? 'rtl' : 'ltr';
  ctx.textAlign = align;
  ctx.fillStyle = color;
}

function fitText(ctx, value, maxWidth, options) {
  let text = cleanText(value, '', 260);
  prepareText(ctx, text, options);
  if (ctx.measureText(text).width <= maxWidth) return text;
  const chars = Array.from(text);
  while (chars.length > 1) {
    chars.pop();
    text = `${chars.join('')}\u2026`;
    if (ctx.measureText(text).width <= maxWidth) return text;
  }
  return '\u2026';
}

function drawText(ctx, value, x, y, maxWidth, options) {
  const text = fitText(ctx, value, maxWidth, options);
  prepareText(ctx, text, options);
  ctx.fillText(text, x, y);
}

function wrapLines(ctx, value, maxWidth, options, maxLines) {
  const words = cleanText(value, '', 420).split(/\s+/).filter(Boolean);
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

function fillRoundRect(ctx, x, y, width, height, radius, color, stroke = null, lineWidth = 2) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fillStyle = color;
  ctx.fill();
  if (stroke) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
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

function drawLogo(ctx, image, name, cx, cy, size, theme) {
  if (image) {
    const scale = Math.min(size / image.width, size / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    ctx.save();
    ctx.shadowColor = theme.light ? 'rgba(15,23,42,0.18)' : 'rgba(255,255,255,0.18)';
    ctx.shadowBlur = size * 0.08;
    ctx.drawImage(image, cx - width / 2, cy - height / 2, width, height);
    ctx.restore();
    return;
  }
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = theme.accentSoft;
  ctx.fill();
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 2;
  ctx.stroke();
  drawText(ctx, initials(name), cx, cy + size * 0.1, size * 0.62, {
    size: size * 0.28, bold: true, align: 'center', color: theme.accent,
  });
}

function staticLabel(kind, language) {
  const labels = {
    'match-result': { en: 'MATCH RESULT', ar: '\u0627\u0644\u0646\u062a\u064a\u062c\u0629' },
    standings: { en: 'STANDINGS', ar: '\u062c\u062f\u0648\u0644 \u0627\u0644\u062a\u0631\u062a\u064a\u0628' },
    'news-promo': { en: 'NEWS', ar: '\u0623\u062e\u0628\u0627\u0631' },
  }[kind] || { en: 'GRAPHIC', ar: '\u062a\u0635\u0645\u064a\u0645' };
  if (language === 'ar') return labels.ar;
  if (language === 'both') return `${labels.en} / ${labels.ar}`;
  return labels.en;
}

function outputSettings(input) {
  const format = FORMATS[input?.format] || FORMATS['16:9'];
  const scale = [1, 2, 3].includes(Number(input?.scale)) ? Number(input.scale) : 2;
  return { ...format, scale, theme: THEMES[input?.style] || THEMES['ewc-teal'] };
}

function createBase(input) {
  const { width, height, scale, theme } = outputSettings(input);
  const canvas = createCanvas(width * scale, height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, theme.background);
  gradient.addColorStop(0.5, theme.surface);
  gradient.addColorStop(1, theme.background);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(width * 0.5, height, 0, width * 0.5, height, width * 0.8);
  glow.addColorStop(0, `${theme.accent}2b`);
  glow.addColorStop(1, `${theme.accent}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  const edge = Math.max(5, width * 0.004);
  ctx.fillStyle = theme.accent;
  ctx.fillRect(0, 0, edge, height);

  const pad = Math.max(42, Math.min(width, height) * 0.055);
  drawText(ctx, 'ESPORTS COMMUNITY', pad, pad * 1.05, width * 0.45, {
    size: Math.max(18, Math.min(width, height) * 0.024), bold: true, align: 'left', color: theme.accent,
  });
  drawText(ctx, staticLabel(input.template, input.language), width - pad, pad * 1.05, width * 0.46, {
    size: Math.max(15, Math.min(width, height) * 0.019), bold: true, align: 'right', color: theme.muted,
  });
  return { canvas, ctx, width, height, theme, pad };
}

function contentAlignment(input, width, pad) {
  if (input.alignment === 'left') return { x: pad, align: 'left' };
  if (input.alignment === 'right') return { x: width - pad, align: 'right' };
  return { x: width / 2, align: 'center' };
}

function drawFooter(ctx, width, height, pad, theme) {
  const y = height - pad * 0.78;
  ctx.strokeStyle = theme.softBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, y - 34);
  ctx.lineTo(width - pad, y - 34);
  ctx.stroke();
  drawText(ctx, 'esportscommunity.net', width / 2, y, width * 0.7, {
    size: Math.max(15, Math.min(width, height) * 0.018), bold: true, align: 'center', color: theme.muted,
  });
}

async function drawBrand(ctx, input, width, height, pad, theme) {
  if (!input.brandLogo) return;
  const image = await loadLogoImage(input.brandLogo);
  if (!image) return;
  const size = Math.min(width, height) * Math.min(24, Math.max(5, Number(input.brandSize) || 12)) / 100;
  const half = size / 2;
  const positions = {
    'top-left': [pad + half, pad + half],
    'top-right': [width - pad - half, pad + half],
    'bottom-left': [pad + half, height - pad - half],
    'bottom-right': [width - pad - half, height - pad - half],
  };
  const chosen = positions[input.brandPlacement];
  let x = chosen ? chosen[0] : width * Math.min(95, Math.max(5, Number(input.brandX) || 88)) / 100;
  let y = chosen ? chosen[1] : height * Math.min(95, Math.max(5, Number(input.brandY) || 12)) / 100;
  x = Math.min(width - pad - half, Math.max(pad + half, x));
  y = Math.min(height - pad - half, Math.max(pad + half, y));
  const box = size * 1.3;
  fillRoundRect(ctx, x - box / 2, y - box / 2, box, box, box * 0.18, `${theme.surface}e6`, theme.softBorder, 1);
  drawLogo(ctx, image, 'Brand', x, y, size, theme);
}

function drawTeam(ctx, { image, name, cx, cy, logoSize, nameWidth, theme }) {
  fillRoundRect(ctx, cx - logoSize * 0.65, cy - logoSize * 0.65, logoSize * 1.3, logoSize * 1.3, logoSize * 0.22, theme.raised, theme.border);
  drawLogo(ctx, image, name, cx, cy, logoSize * 0.82, theme);
  drawText(ctx, name, cx, cy + logoSize * 0.96, nameWidth, {
    size: Math.max(24, logoSize * 0.24), bold: true, align: 'center', color: theme.text,
  });
}

async function renderMatchResult(input) {
  const base = createBase(input);
  const { canvas, ctx, width, height, theme, pad } = base;
  const [logoA, logoB] = await Promise.all([loadLogoImage(input.logoA), loadLogoImage(input.logoB)]);
  const title = cleanText(input.tournament, 'Tournament', 120);
  const game = cleanText(input.game, 'Esports', 80);
  const horizontal = width / height >= 1.2;
  const titleAlign = contentAlignment(input, width, pad);
  const hasScore = input.scoreA !== null && input.scoreA !== undefined
    && input.scoreB !== null && input.scoreB !== undefined
    && Number.isFinite(Number(input.scoreA)) && Number.isFinite(Number(input.scoreB));
  const score = hasScore ? `${Number(input.scoreA)} - ${Number(input.scoreB)}` : 'VS';
  const status = input.status === 'live'
    ? (input.language === 'ar' ? '\u0645\u0628\u0627\u0634\u0631' : 'LIVE')
    : input.status === 'upcoming'
      ? (input.language === 'ar' ? '\u0642\u0627\u062f\u0645\u0627\u064b' : 'SOON')
      : (input.language === 'ar' ? '\u0646\u0647\u0627\u0626\u064a' : 'FINAL');

  drawText(ctx, title, titleAlign.x, horizontal ? height * 0.22 : height * 0.15, width - pad * 2, {
    size: Math.max(34, Math.min(width, height) * (horizontal ? 0.055 : 0.044)),
    bold: true, align: titleAlign.align, color: theme.text,
  });
  drawText(ctx, game, titleAlign.x, horizontal ? height * 0.28 : height * 0.19, width - pad * 2, {
    size: Math.max(20, Math.min(width, height) * 0.025), align: titleAlign.align, color: theme.muted,
  });

  if (horizontal) {
    const logoSize = Math.min(width * 0.12, height * 0.2);
    drawTeam(ctx, { image: logoA, name: input.teamA, cx: width * 0.23, cy: height * 0.5, logoSize, nameWidth: width * 0.3, theme });
    drawTeam(ctx, { image: logoB, name: input.teamB, cx: width * 0.77, cy: height * 0.5, logoSize, nameWidth: width * 0.3, theme });
    drawText(ctx, score, width / 2, height * 0.56, width * 0.28, {
      size: Math.min(width, height) * 0.105, bold: true, align: 'center', color: theme.text,
    });
  } else {
    const logoSize = Math.min(width * 0.2, height * 0.12);
    drawTeam(ctx, { image: logoA, name: input.teamA, cx: width / 2, cy: height * 0.3, logoSize, nameWidth: width * 0.72, theme });
    drawText(ctx, score, width / 2, height * 0.52, width * 0.72, {
      size: Math.min(width, height) * 0.085, bold: true, align: 'center', color: theme.text,
    });
    drawTeam(ctx, { image: logoB, name: input.teamB, cx: width / 2, cy: height * 0.7, logoSize, nameWidth: width * 0.72, theme });
  }

  fillRoundRect(ctx, width / 2 - 95, height * (horizontal ? 0.64 : 0.57), 190, 42, 21, theme.accentSoft, theme.border);
  drawText(ctx, status, width / 2, height * (horizontal ? 0.675 : 0.59), 160, {
    size: 18, bold: true, align: 'center', color: theme.accent,
  });
  drawFooter(ctx, width, height, pad, theme);
  await drawBrand(ctx, input, width, height, pad, theme);
  return canvas.toBuffer('image/png');
}

async function renderStandings(input) {
  const base = createBase(input);
  const { canvas, ctx, width, height, theme, pad } = base;
  const entries = Array.isArray(input.entries) ? input.entries.slice(0, 6) : [];
  const logos = await Promise.all(entries.map((entry) => loadLogoImage(entry.logo)));
  const align = contentAlignment(input, width, pad);
  const titleY = height * 0.15;
  drawText(ctx, cleanText(input.tournament, 'Tournament', 120), align.x, titleY, width - pad * 2, {
    size: Math.max(32, Math.min(width, height) * 0.048), bold: true, align: align.align, color: theme.text,
  });
  drawText(ctx, cleanText(input.section, 'Standings', 100), align.x, titleY + Math.max(40, height * 0.045), width - pad * 2, {
    size: Math.max(20, Math.min(width, height) * 0.025), align: align.align, color: theme.muted,
  });

  const startY = height * 0.28;
  const available = height * 0.56;
  const gap = Math.max(10, height * 0.009);
  const rowHeight = Math.min(92, (available - gap * Math.max(0, entries.length - 1)) / Math.max(1, entries.length));
  entries.forEach((entry, index) => {
    const y = startY + index * (rowHeight + gap);
    fillRoundRect(ctx, pad, y, width - pad * 2, rowHeight, Math.min(18, rowHeight * 0.18), index === 0 ? theme.accentSoft : theme.row, index === 0 ? theme.border : theme.softBorder, 1);
    drawText(ctx, String(Number(entry.rank) || index + 1), pad + rowHeight * 0.55, y + rowHeight * 0.64, rowHeight * 0.7, {
      size: rowHeight * 0.3, bold: true, align: 'center', color: index === 0 ? theme.accent : theme.muted,
    });
    drawLogo(ctx, logos[index], entry.team, pad + rowHeight * 1.35, y + rowHeight / 2, rowHeight * 0.52, theme);
    drawText(ctx, entry.team, pad + rowHeight * 1.85, y + rowHeight * 0.64, width - pad * 2 - rowHeight * 4.5, {
      size: rowHeight * 0.3, bold: true, align: 'left', color: theme.text,
    });
    drawText(ctx, entry.points || entry.extra || '-', width - pad - rowHeight * 0.35, y + rowHeight * 0.64, rowHeight * 2.2, {
      size: rowHeight * 0.29, bold: true, align: 'right', color: index === 0 ? theme.accent : theme.text,
    });
  });
  drawFooter(ctx, width, height, pad, theme);
  await drawBrand(ctx, input, width, height, pad, theme);
  return canvas.toBuffer('image/png');
}

async function renderNewsPromo(input) {
  const base = createBase(input);
  const { canvas, ctx, width, height, theme, pad } = base;
  const alignment = contentAlignment(input, width, pad);
  const owner = cleanText(input.owner, 'Community', 80);
  const chipWidth = Math.min(280, width * 0.32);
  const chipX = alignment.align === 'center' ? width / 2 - chipWidth / 2 : alignment.align === 'right' ? width - pad - chipWidth : pad;
  fillRoundRect(ctx, chipX, height * 0.2, chipWidth, 44, 22, theme.accentSoft, theme.border);
  drawText(ctx, owner, chipX + chipWidth / 2, height * 0.2 + 30, chipWidth - 28, {
    size: 18, bold: true, align: 'center', color: theme.accent,
  });

  const title = cleanText(input.title, 'Community update', 220);
  const titleSize = Math.max(42, Math.min(width, height) * (height > width ? 0.062 : 0.07));
  const titleWidth = width - pad * 2;
  const titleLines = wrapLines(ctx, title, titleWidth, { size: titleSize, bold: true, color: theme.text }, height > width ? 5 : 3);
  const titleStart = height * 0.34;
  const lineHeight = titleSize * 1.18;
  titleLines.forEach((line, index) => {
    drawText(ctx, line, alignment.x, titleStart + index * lineHeight, titleWidth, {
      size: titleSize, bold: true, align: alignment.align, color: theme.text,
    });
  });

  const summary = cleanText(input.summary, '', 360);
  if (summary) {
    const summarySize = Math.max(24, Math.min(width, height) * 0.03);
    const lines = wrapLines(ctx, summary, titleWidth, { size: summarySize, color: theme.muted }, height > width ? 5 : 3);
    const summaryY = Math.max(height * 0.67, titleStart + titleLines.length * lineHeight + summarySize * 1.4);
    lines.forEach((line, index) => {
      drawText(ctx, line, alignment.x, summaryY + index * summarySize * 1.35, titleWidth, {
        size: summarySize, align: alignment.align, color: theme.muted,
      });
    });
  }
  drawFooter(ctx, width, height, pad, theme);
  await drawBrand(ctx, input, width, height, pad, theme);
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
