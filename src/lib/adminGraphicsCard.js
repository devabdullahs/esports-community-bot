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
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '4:5': { width: 1080, height: 1350 },
};

// Base palettes per the graphics-generator design spec. Every color the
// renderer uses is derived from these — nothing downstream hard-codes teal,
// so each style restyles the entire graphic.
const STYLES = {
  'ewc-teal': {
    accent: '#2dd4bf', accentSoft: '#5eead4',
    stops: ['#071412', '#0a1a18', '#061110'], base: '#0a1a18',
    text: '#fafafa', muted: '#8b9d9a', dark: true,
  },
  midnight: {
    accent: '#60a5fa', accentSoft: '#93c5fd',
    stops: ['#080d20', '#0d1530', '#070b1a'], base: '#0d1530',
    text: '#f8fbff', muted: '#8b96b8', dark: true,
  },
  carbon: {
    accent: '#e4e4e7', accentSoft: '#fafafa',
    stops: ['#0e0e10', '#17171a', '#0c0c0e'], base: '#17171a',
    text: '#fafafa', muted: '#8f8f98', dark: true,
  },
  slate: {
    accent: '#94a3b8', accentSoft: '#cbd5e1',
    stops: ['#141a1e', '#1f272c', '#11171a'], base: '#1f272c',
    text: '#f1f5f9', muted: '#8b9aa8', dark: true,
  },
  light: {
    accent: '#0f766e', accentSoft: '#115e59',
    stops: ['#eef1f0', '#ffffff', '#e7ecea'], base: '#ffffff',
    text: '#0c1513', muted: '#5b6b68', dark: false,
  },
};

function hexChannel(hex, index) {
  return parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
}

// color-mix(in srgb, color pct%, base) equivalent for solid hex colors.
function mixHex(color, pct, base) {
  const p = pct / 100;
  const channel = (index) => Math.round(hexChannel(color, index) * p + hexChannel(base, index) * (1 - p));
  return `#${[0, 1, 2].map((index) => channel(index).toString(16).padStart(2, '0')).join('')}`;
}

// color@pct — hex color with an alpha channel.
function alphaHex(color, pct) {
  return `${color}${Math.round((pct / 100) * 255).toString(16).padStart(2, '0')}`;
}

function buildTheme(styleId) {
  const s = STYLES[styleId] || STYLES['ewc-teal'];
  return {
    ...s,
    light: !s.dark,
    glow: alphaHex(s.accent, 18),
    edgeBarBottom: mixHex(s.accent, 55, s.base),
    edgeLine: alphaHex(s.accent, 40),
    hairline: s.dark ? '#ffffff14' : '#00000014',
    divider: s.dark ? '#ffffff22' : '#00000022',
    tileHomeBg: mixHex(s.accent, s.dark ? 14 : 10, s.base),
    tileHomeBorder: alphaHex(s.accent, 35),
    tileAwayBg: s.dark ? '#ffffff10' : '#00000008',
    tileAwayBorder: s.dark ? '#ffffff1f' : '#00000015',
    tileAwayText: s.dark ? '#d4d4d8' : '#3f4a48',
    pillBg: alphaHex(s.accent, 10),
    pillBorder: alphaHex(s.accent, 30),
    pillText: s.dark ? s.accentSoft : s.accent,
    rowBg: s.dark ? '#ffffff0a' : '#00000006',
    logoBg: mixHex(s.accent, s.dark ? 16 : 10, s.base),
    logoBorder: alphaHex(s.accent, 35),
  };
}

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

function prepareText(ctx, value, { size, bold = false, align = 'left', color, tracking = 0 } = {}) {
  ctx.font = fontFor(size, bold);
  ctx.direction = hasArabic(value) ? 'rtl' : 'ltr';
  // Tracking must be zero for Arabic — letter-spacing breaks script joining.
  ctx.letterSpacing = hasArabic(value) ? '0px' : `${tracking}px`;
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
  ctx.fillStyle = theme.logoBg;
  ctx.fill();
  ctx.strokeStyle = theme.logoBorder;
  ctx.lineWidth = 2;
  ctx.stroke();
  drawText(ctx, initials(name), cx, cy + size * 0.1, size * 0.62, {
    size: size * 0.28, bold: true, align: 'center', color: theme.accent,
  });
}

const COMMUNITY_LABEL = {
  en: 'ESPORTS COMMUNITY',
  ar: 'مجتمع الرياضات الإلكترونية',
};

function staticLabel(kind, language) {
  const labels = {
    'match-result': { en: 'MATCH RESULT', ar: 'نتيجة المباراة' },
    standings: { en: 'STANDINGS', ar: 'جدول الترتيب' },
    'news-promo': { en: 'NEWS', ar: 'أخبار' },
  }[kind] || { en: 'GRAPHIC', ar: 'تصميم' };
  if (language === 'ar') return labels.ar;
  if (language === 'both') return `${labels.en} • ${labels.ar}`;
  return labels.en;
}

function outputSettings(input) {
  const format = FORMATS[input?.format] || FORMATS['16:9'];
  const scale = [1, 2, 3].includes(Number(input?.scale)) ? Number(input.scale) : 2;
  return { ...format, scale, theme: buildTheme(input?.style) };
}

function createBase(input) {
  const { width, height, scale, theme } = outputSettings(input);
  const canvas = createCanvas(width * scale, height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  const rtl = input.language === 'ar';

  // 160deg three-stop field gradient (mid stop at 45%).
  const gradient = ctx.createLinearGradient(width * 0.33, 0, width * 0.67, height);
  gradient.addColorStop(0, theme.stops[0]);
  gradient.addColorStop(theme.dark ? 0.45 : 0.55, theme.stops[1]);
  gradient.addColorStop(1, theme.stops[2]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Accent glow rising from the bottom edge.
  const glow = ctx.createRadialGradient(width * 0.5, height * 1.2, 0, width * 0.5, height * 1.2, height * 1.1);
  glow.addColorStop(0, theme.glow);
  glow.addColorStop(0.6, alphaHex(theme.accent, 0));
  glow.addColorStop(1, alphaHex(theme.accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // Leading accent edge bar (gradient, not flat).
  const edge = Math.max(5, Math.round(width * 0.003));
  const bar = ctx.createLinearGradient(0, 0, 0, height);
  bar.addColorStop(0, theme.accent);
  bar.addColorStop(1, theme.edgeBarBottom);
  ctx.fillStyle = bar;
  const barX = rtl ? width - edge : 0;
  ctx.fillRect(barX, 0, edge, height);

  // Trailing hairline accent fade opposite the edge bar.
  const lineX = rtl ? Math.max(18, width * 0.0125) : width - Math.max(18, width * 0.0125);
  const line = ctx.createLinearGradient(0, height * 0.07, 0, height * 0.93);
  line.addColorStop(0, alphaHex(theme.accent, 0));
  line.addColorStop(0.5, theme.edgeLine);
  line.addColorStop(1, alphaHex(theme.accent, 0));
  ctx.fillStyle = line;
  ctx.fillRect(lineX, height * 0.07, 2, height * 0.86);

  // Header row. RTL mirrors the two labels: community label sits on the
  // trailing side for Arabic, exactly like dir="rtl" flexbox would place it.
  const pad = Math.max(42, Math.min(width, height) * 0.055);
  const headerY = pad * 1.05;
  const community = rtl ? COMMUNITY_LABEL.ar : COMMUNITY_LABEL.en;
  const headerSize = Math.max(18, Math.min(width, height) * 0.022);
  const subSize = Math.max(15, Math.min(width, height) * 0.018);
  drawText(ctx, community, rtl ? width - pad : pad, headerY, width * 0.45, {
    size: headerSize, bold: true, align: rtl ? 'right' : 'left', color: theme.accent, tracking: headerSize * 0.18,
  });
  drawText(ctx, staticLabel(input.template, input.language), rtl ? pad : width - pad, headerY, width * 0.46, {
    size: subSize, bold: true, align: rtl ? 'left' : 'right', color: theme.muted, tracking: subSize * 0.14,
  });
  return { canvas, ctx, width, height, theme, pad, rtl };
}

function contentAlignment(input, width, pad) {
  if (input.alignment === 'left') return { x: pad, align: 'left' };
  if (input.alignment === 'right') return { x: width - pad, align: 'right' };
  return { x: width / 2, align: 'center' };
}

function drawFooter(ctx, width, height, pad, theme) {
  const y = height - pad * 0.78;
  ctx.strokeStyle = theme.hairline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, y - 34);
  ctx.lineTo(width - pad, y - 34);
  ctx.stroke();
  const size = Math.max(15, Math.min(width, height) * 0.017);
  drawText(ctx, 'esportscommunity.net', width / 2, y, width * 0.7, {
    size, bold: true, align: 'center', color: theme.muted, tracking: size * 0.1,
  });
}

async function drawBrand(ctx, input, width, height, pad) {
  if (!input.brandLogo && !input.brandImage) return;
  const image = input.brandImage || await loadLogoImage(input.brandLogo);
  if (!image) return;
  const maxExtent = Math.min(width, height) * Math.min(24, Math.max(5, Number(input.brandSize) || 12)) / 100;
  const imageScale = Math.min(maxExtent / image.width, maxExtent / image.height);
  const imageWidth = Math.max(1, image.width * imageScale);
  const imageHeight = Math.max(1, image.height * imageScale);
  const halfWidth = imageWidth / 2;
  const halfHeight = imageHeight / 2;
  const footerDividerY = height - pad * 0.78 - 34;
  const footerGap = Math.max(12, pad * 0.12);
  const bottomY = footerDividerY - footerGap - halfHeight;
  const positions = {
    'top-left': [pad + halfWidth, pad + halfHeight],
    'top-right': [width - pad - halfWidth, pad + halfHeight],
    'bottom-left': [pad + halfWidth, bottomY],
    'bottom-right': [width - pad - halfWidth, bottomY],
  };
  const chosen = positions[input.brandPlacement];
  let x = chosen ? chosen[0] : width * Math.min(95, Math.max(5, Number(input.brandX) || 88)) / 100;
  let y = chosen ? chosen[1] : height * Math.min(95, Math.max(5, Number(input.brandY) || 12)) / 100;
  x = Math.min(width - pad - halfWidth, Math.max(pad + halfWidth, x));
  y = Math.min(height - pad - halfHeight, Math.max(pad + halfHeight, y));

  // Branding is the final compositing pass for every template. Force normal
  // source-over rendering here so no earlier clipping/composite state can put
  // the channel logo behind the generated card.
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(image, x - imageWidth / 2, y - imageHeight / 2, imageWidth, imageHeight);
  ctx.restore();
}

function wrapAllLines(ctx, value, maxWidth, options) {
  const words = cleanText(value, '', 420).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    prepareText(ctx, next, options);
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawFittedTitle(ctx, value, x, top, maxWidth, options, { maxLines = 2, minSize = 18, maxHeight = Infinity } = {}) {
  let size = options.size;
  let lines = [];
  while (size >= minSize) {
    const candidateOptions = { ...options, size };
    lines = wrapAllLines(ctx, value, maxWidth, candidateOptions);
    const lineHeight = size * 1.12;
    const allFit = lines.every((line) => {
      prepareText(ctx, line, candidateOptions);
      return ctx.measureText(line).width <= maxWidth;
    });
    if (lines.length <= maxLines && lines.length * lineHeight <= maxHeight && allFit) break;
    size -= 1;
  }

  size = Math.max(minSize, size);
  const fittedOptions = { ...options, size };
  lines = wrapAllLines(ctx, value, maxWidth, fittedOptions);
  const lineHeight = fittedOptions.size * 1.12;
  lines.forEach((line, index) => {
    prepareText(ctx, line, fittedOptions);
    ctx.fillText(line, x, top + fittedOptions.size + index * lineHeight);
  });
  return { bottom: top + fittedOptions.size + Math.max(0, lines.length - 1) * lineHeight, size: fittedOptions.size };
}

// Team tile per the spec: the home side is accent-tinted, the away side stays
// neutral, and the monogram fills the tile when no logo exists.
function drawTeam(ctx, { image, name, cx, cy, logoSize, nameWidth, theme, home }) {
  const tile = logoSize * 1.3;
  const radius = tile * 0.2;
  fillRoundRect(
    ctx,
    cx - tile / 2,
    cy - tile / 2,
    tile,
    tile,
    radius,
    home ? theme.tileHomeBg : theme.tileAwayBg,
    home ? theme.tileHomeBorder : theme.tileAwayBorder,
  );
  if (image) {
    drawLogo(ctx, image, name, cx, cy, logoSize * 0.82, theme);
  } else {
    drawText(ctx, initials(name), cx, cy + tile * 0.11, tile * 0.72, {
      size: tile * 0.3, bold: true, align: 'center', color: home ? theme.accent : theme.tileAwayText,
    });
  }
  drawText(ctx, name, cx, cy + logoSize * 0.96, nameWidth, {
    size: Math.max(24, logoSize * 0.24), bold: true, align: 'center', color: theme.text,
  });
}

function drawStatusPill(ctx, text, cx, cy, theme) {
  const size = 18;
  prepareText(ctx, text, { size, bold: true, tracking: hasArabic(text) ? 0 : size * 0.08 });
  const textWidth = Math.min(220, ctx.measureText(cleanText(text, '', 60)).width);
  const pillWidth = Math.max(150, textWidth + 56);
  fillRoundRect(ctx, cx - pillWidth / 2, cy - 21, pillWidth, 42, 21, theme.pillBg, theme.pillBorder, 1.5);
  drawText(ctx, text, cx, cy + 6.5, pillWidth - 32, {
    size, bold: true, align: 'center', color: theme.pillText, tracking: size * 0.08,
  });
}

async function renderMatchResult(input) {
  const base = createBase(input);
  const { canvas, ctx, width, height, theme, pad } = base;
  const [logoA, logoB] = await Promise.all([loadLogoImage(input.logoA), loadLogoImage(input.logoB)]);
  const title = cleanText(input.tournament, 'Tournament', 260);
  const game = cleanText(input.game, 'Esports', 80);
  const horizontal = width / height >= 1.2;
  const titleAlign = contentAlignment(input, width, pad);
  const hasScore = input.scoreA !== null && input.scoreA !== undefined
    && input.scoreB !== null && input.scoreB !== undefined
    && Number.isFinite(Number(input.scoreA)) && Number.isFinite(Number(input.scoreB));
  const score = hasScore ? `${Number(input.scoreA)} - ${Number(input.scoreB)}` : 'VS';
  const status = input.status === 'live'
    ? (input.language === 'ar' ? 'مباشر' : 'LIVE')
    : input.status === 'upcoming'
      ? (input.language === 'ar' ? 'قادماً' : 'SOON')
      : (input.language === 'ar' ? 'نهائي' : 'FINAL');

  const titleTop = horizontal ? height * 0.13 : height * 0.085;
  const titleBlock = drawFittedTitle(ctx, title, titleAlign.x, titleTop, width - pad * 2, {
    size: Math.max(34, Math.min(width, height) * (horizontal ? 0.055 : 0.044)),
    bold: true, align: titleAlign.align, color: theme.text,
  }, { maxLines: 2, minSize: 20, maxHeight: height * (horizontal ? 0.13 : 0.09) });
  const gameSize = Math.max(20, Math.min(width, height) * 0.025);
  drawText(ctx, game, titleAlign.x, titleBlock.bottom + gameSize * 1.45, width - pad * 2, {
    size: gameSize, align: titleAlign.align, color: theme.muted,
  });

  if (horizontal) {
    const logoSize = Math.min(width * 0.12, height * 0.2);
    drawTeam(ctx, { image: logoA, name: input.teamA, cx: width * 0.23, cy: height * 0.5, logoSize, nameWidth: width * 0.3, theme, home: true });
    drawTeam(ctx, { image: logoB, name: input.teamB, cx: width * 0.77, cy: height * 0.5, logoSize, nameWidth: width * 0.3, theme, home: false });
    // The score is always LTR digits, even inside an Arabic layout.
    drawText(ctx, score, width / 2, height * 0.56, width * 0.28, {
      size: Math.min(width, height) * 0.105, bold: true, align: 'center', color: theme.text, tracking: 2,
    });
    drawStatusPill(ctx, status, width / 2, height * 0.665, theme);
  } else {
    const logoSize = Math.min(width * 0.2, height * 0.12);
    drawTeam(ctx, { image: logoA, name: input.teamA, cx: width / 2, cy: height * 0.3, logoSize, nameWidth: width * 0.72, theme, home: true });
    drawText(ctx, score, width / 2, height * 0.52, width * 0.72, {
      size: Math.min(width, height) * 0.085, bold: true, align: 'center', color: theme.text, tracking: 2,
    });
    drawTeam(ctx, { image: logoB, name: input.teamB, cx: width / 2, cy: height * 0.7, logoSize, nameWidth: width * 0.72, theme, home: false });
    drawStatusPill(ctx, status, width / 2, height * 0.585, theme);
  }

  drawFooter(ctx, width, height, pad, theme);
  await drawBrand(ctx, input, width, height, pad);
  return canvas.toBuffer('image/png');
}

async function renderStandings(input) {
  const base = createBase(input);
  const { canvas, ctx, width, height, theme, pad } = base;
  const entries = Array.isArray(input.entries) ? input.entries.slice(0, 6) : [];
  const logos = await Promise.all(entries.map((entry) => loadLogoImage(entry.logo)));
  const align = contentAlignment(input, width, pad);
  const titleTop = height * 0.09;
  const titleBlock = drawFittedTitle(ctx, cleanText(input.tournament, 'Tournament', 260), align.x, titleTop, width - pad * 2, {
    size: Math.max(32, Math.min(width, height) * 0.048), bold: true, align: align.align, color: theme.text,
  }, { maxLines: 2, minSize: 20, maxHeight: height * 0.11 });
  const sectionSize = Math.max(20, Math.min(width, height) * 0.025);
  drawText(ctx, cleanText(input.section, 'Standings', 100), align.x, titleBlock.bottom + sectionSize * 1.45, width - pad * 2, {
    size: sectionSize, align: align.align, color: theme.muted,
  });

  const startY = height * 0.28;
  const available = height * 0.56;
  const gap = Math.max(10, height * 0.009);
  const rowHeight = Math.min(92, (available - gap * Math.max(0, entries.length - 1)) / Math.max(1, entries.length));
  entries.forEach((entry, index) => {
    const y = startY + index * (rowHeight + gap);
    fillRoundRect(ctx, pad, y, width - pad * 2, rowHeight, Math.min(18, rowHeight * 0.18), index === 0 ? theme.pillBg : theme.rowBg, index === 0 ? theme.pillBorder : theme.hairline, 1);
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
  await drawBrand(ctx, input, width, height, pad);
  return canvas.toBuffer('image/png');
}

async function renderNewsPromo(input) {
  const base = createBase(input);
  const { canvas, ctx, width, height, theme, pad } = base;
  const alignment = contentAlignment(input, width, pad);
  const owner = cleanText(input.owner, 'Community', 80);
  const chipWidth = Math.min(280, width * 0.32);
  const chipX = alignment.align === 'center' ? width / 2 - chipWidth / 2 : alignment.align === 'right' ? width - pad - chipWidth : pad;
  fillRoundRect(ctx, chipX, height * 0.2, chipWidth, 44, 22, theme.pillBg, theme.pillBorder, 1.5);
  drawText(ctx, owner, chipX + chipWidth / 2, height * 0.2 + 30, chipWidth - 28, {
    size: 18, bold: true, align: 'center', color: theme.pillText,
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
  await drawBrand(ctx, input, width, height, pad);
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
