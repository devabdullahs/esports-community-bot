import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, GlobalFonts, Path2D } from '@napi-rs/canvas';

// ---------------------------------------------------------------------------
// Fonts (self-contained; mirrors the paths in ewcPredictionLeaderboardCard.js)
// ---------------------------------------------------------------------------
function reg(paths, family) {
  for (const p of paths) {
    try {
      GlobalFonts.registerFromPath(p, family);
      return family;
    } catch {
      /* try next */
    }
  }
  return null;
}
function sys(name) {
  return GlobalFonts.families.some((f) => f.family === name) ? name : null;
}

const HEAD =
  reg(
    [
      'C:/Windows/Fonts/segoeuib.ttf',
      'C:/Windows/Fonts/arialbd.ttf',
      '/usr/share/fonts/opentype/inter/Inter-Bold.otf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
      '/Library/Fonts/Arial Bold.ttf',
    ],
    'EwcShareHead',
  ) || 'sans-serif';
const BODY =
  reg(
    [
      'C:/Windows/Fonts/segoeui.ttf',
      'C:/Windows/Fonts/arial.ttf',
      '/usr/share/fonts/opentype/inter/Inter-Regular.otf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/Library/Fonts/Arial.ttf',
    ],
    'EwcShareBody',
  ) || 'sans-serif';
// Prefer a plain, Linux-friendly Arabic stack. Noto Arabic is installed in the
// production image; register it before Latin fallbacks so the canvas renderer
// does not choose a family that lacks Arabic glyphs and draw square boxes.
const ARABIC =
  sys('Noto Sans Arabic') ||
  reg(
    [
      '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf',
      '/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf',
      '/usr/share/fonts/opentype/noto/NotoSansArabic-Regular.ttf',
      'C:/Windows/Fonts/arial.ttf',
      'C:/Windows/Fonts/segoeui.ttf',
      '/Library/Fonts/Arial.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ],
    'EwcShareArabic',
  ) ||
  sys('Arial') ||
  sys('Arial Unicode MS') ||
  sys('Segoe UI') ||
  'Arial';
const EMOJI =
  sys('Noto Color Emoji') ||
  reg(['C:/Windows/Fonts/seguiemj.ttf', '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf'], 'EwcShareEmoji');

function q(f) {
  return f && /[\s]/.test(f) ? `"${f}"` : f;
}
function stackFor(ch, base) {
  const code = ch.codePointAt(0) || 0;
  if (/\p{Script=Arabic}/u.test(ch) && ARABIC) return q(ARABIC);
  if (code > 0x7f && /\p{Emoji}/u.test(ch) && EMOJI) return q(EMOJI);
  return q(base);
}

function hasArabic(text) {
  return /\p{Script=Arabic}/u.test(String(text ?? ''));
}

function cssFont(size, weight, stack) {
  return `${weight ? `${weight} ` : ''}${size}px ${stack}`;
}

function arabicStack(base) {
  return [q(ARABIC), q(base)].filter(Boolean).join(', ');
}

// ---------------------------------------------------------------------------
// Palette — mirrors the website's dark surface, blue primary, and quiet borders.
// ---------------------------------------------------------------------------
const COLORS = {
  bg0: '#080d16',
  bg1: '#0b111d',
  card: '#111820',
  cardAlt: '#151d28',
  primary: '#3b82f6',
  primarySoft: 'rgba(59,130,246,0.14)',
  primaryRing: 'rgba(59,130,246,0.52)',
  textHi: '#f4f7fb',
  textMid: '#a9b7c8',
  textLow: '#718096',
  line: 'rgba(255,255,255,0.08)',
  lineStrong: 'rgba(255,255,255,0.14)',
  chipBg: 'rgba(255,255,255,0.06)',
  chipBorder: 'rgba(255,255,255,0.10)',
  discord: '#5865f2',
};

const DISCORD_GLYPH = new Path2D(
  'M81.15,0c-1.2376,2.1973-2.3489,4.4704-3.3591,6.794-9.5975-1.4396-19.3718-1.4396-28.9945,0-.985-2.3236-2.1216-4.5967-3.3591-6.794-9.0166,1.5407-17.8059,4.2431-26.1405,8.0568C2.779,32.5304-1.6914,56.3725.5312,79.8863c9.6732,7.1476,20.5083,12.603,32.0505,16.0884,2.6014-3.4854,4.8998-7.1981,6.8698-11.0623-3.738-1.3891-7.3497-3.1318-10.8098-5.1523.9092-.6567,1.7932-1.3386,2.6519-1.9953,20.281,9.547,43.7696,9.547,64.0758,0,.8587.7072,1.7427,1.3891,2.6519,1.9953-3.4601,2.0457-7.0718,3.7632-10.835,5.1776,1.97,3.8642,4.2683,7.5769,6.8698,11.0623,11.5419-3.4854,22.3769-8.9156,32.0509-16.0631,2.626-27.2771-4.496-50.9172-18.817-71.8548C98.9811,4.2684,90.1918,1.5659,81.1752.0505l-.0252-.0505ZM42.2802,65.4144c-6.2383,0-11.4159-5.6575-11.4159-12.6535s4.9755-12.6788,11.3907-12.6788,11.5169,5.708,11.4159,12.6788c-.101,6.9708-5.026,12.6535-11.3907,12.6535ZM84.3576,65.4144c-6.2637,0-11.3907-5.6575-11.3907-12.6535s4.9755-12.6788,11.3907-12.6788,11.4917,5.708,11.3906,12.6788c-.101,6.9708-5.026,12.6535-11.3906,12.6535Z',
);

const BRAND_LOGO_PATH = fileURLToPath(new URL('../../apps/web/src/app/apple-icon.png', import.meta.url));
let brandLogoPromise = null;

async function getBrandLogo() {
  if (!brandLogoPromise) {
    brandLogoPromise = loadImage(BRAND_LOGO_PATH).catch(() => null);
  }
  return brandLogoPromise;
}

// ---------------------------------------------------------------------------
// Low-level drawing helpers
// ---------------------------------------------------------------------------
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Split text into same-font runs so Arabic/emoji shape correctly, measure total width.
function runs(ctx, text, size, weight, base) {
  const out = [];
  let run = '';
  let stack = null;
  for (const ch of Array.from(String(text ?? ''))) {
    const s = stackFor(ch, base);
    if (run && s !== stack) {
      out.push({ text: run, stack });
      run = '';
    }
    stack = s;
    run += ch;
  }
  if (run) out.push({ text: run, stack });
  let width = 0;
  for (const r of out) {
    ctx.font = cssFont(size, weight, r.stack);
    r.width = ctx.measureText(r.text).width;
    width += r.width;
  }
  return { out, width };
}

// Draw mixed-script text with alignment ('left' anchors at x, 'right' ends at x, 'center' centers on x).
function drawText(ctx, text, x, y, { size, weight = '', base, align = 'left', color, maxWidth } = {}) {
  if (hasArabic(text)) {
    const stack = arabicStack(base);
    let value = String(text ?? '');
    ctx.save();
    ctx.font = cssFont(size, weight, stack);
    ctx.direction = 'rtl';
    ctx.textAlign = align;
    if (color) ctx.fillStyle = color;
    if (maxWidth && ctx.measureText(value).width > maxWidth) {
      const chars = Array.from(value);
      while (chars.length > 1) {
        chars.pop();
        const probe = `${chars.join('')}...`;
        if (ctx.measureText(probe).width <= maxWidth) {
          value = probe;
          break;
        }
      }
    }
    ctx.fillText(value, x, y);
    const width = ctx.measureText(value).width;
    ctx.restore();
    return width;
  }

  let { out, width } = runs(ctx, text, size, weight, base);
  if (maxWidth && width > maxWidth) {
    let chars = Array.from(String(text ?? ''));
    while (chars.length > 1) {
      chars.pop();
      const probe = runs(ctx, `${chars.join('')}…`, size, weight, base);
      if (probe.width <= maxWidth) {
        out = probe.out;
        width = probe.width;
        break;
      }
    }
  }
  let cursor = align === 'right' ? x - width : align === 'center' ? x - width / 2 : x;
  if (color) ctx.fillStyle = color;
  ctx.textAlign = 'left';
  for (const r of out) {
    ctx.font = cssFont(size, weight, r.stack);
    ctx.fillText(r.text, cursor, y);
    cursor += r.width;
  }
  return width;
}

function textWidth(ctx, text, size, weight, base) {
  if (hasArabic(text)) {
    ctx.save();
    ctx.font = cssFont(size, weight, arabicStack(base));
    const width = ctx.measureText(String(text ?? '')).width;
    ctx.restore();
    return width;
  }
  return runs(ctx, text, size, weight, base).width;
}

// ---------------------------------------------------------------------------
// Component helpers
// ---------------------------------------------------------------------------
function drawEcLogo(ctx, cx, cy, r, label) {
  const size = r * 2.15;
  roundRect(ctx, cx - size / 2, cy - size / 2, size, size, 14);
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, COLORS.primarySoft);
  g.addColorStop(1, 'rgba(255,255,255,0.035)');
  ctx.fillStyle = g;
  ctx.fill();
  roundRect(ctx, cx - size / 2, cy - size / 2, size, size, 14);
  ctx.strokeStyle = COLORS.primaryRing;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  drawText(ctx, label, cx, cy + r * 0.24, { size: Math.round(r * 0.72), weight: 'bold', base: HEAD, align: 'center', color: COLORS.primary });
}

function drawBrandLogo(ctx, cx, cy, r, logoImg) {
  if (!logoImg) {
    drawEcLogo(ctx, cx, cy, r, 'EC');
    return;
  }
  const size = r * 2.15;
  roundRect(ctx, cx - size / 2, cy - size / 2, size, size, 14);
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, COLORS.primarySoft);
  g.addColorStop(1, 'rgba(255,255,255,0.035)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  roundRect(ctx, cx - size / 2, cy - size / 2, size, size, 14);
  ctx.clip();
  ctx.drawImage(logoImg, cx - size / 2, cy - size / 2, size, size);
  ctx.restore();
  roundRect(ctx, cx - size / 2, cy - size / 2, size, size, 14);
  ctx.strokeStyle = COLORS.primaryRing;
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

// Monochrome Discord glyph (no emoji font dependency).
function drawDiscordIcon(ctx, cx, cy, size, color) {
  ctx.save();
  const w = size * (126.644 / 96);
  ctx.translate(cx - w / 2, cy - size / 2);
  ctx.scale(w / 126.644, size / 96);
  ctx.fillStyle = color;
  ctx.fill(DISCORD_GLYPH, 'evenodd');
  ctx.restore();
}

function drawCardBackground(ctx, W, H) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, COLORS.bg0);
  g.addColorStop(1, COLORS.bg1);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Same restrained blue ambiance used behind the website hero.
  const rg = ctx.createRadialGradient(W * 0.5, -H * 0.12, 0, W * 0.5, -H * 0.12, W * 0.72);
  rg.addColorStop(0, 'rgba(59,130,246,0.18)');
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  roundRect(ctx, 14, 14, W - 28, H - 28, 26);
  ctx.stroke();
}

function drawPill(ctx, text, anchorX, y, { align = 'right', size = 17 } = {}) {
  const w = textWidth(ctx, text, size, 'bold', BODY) + 36;
  const h = size + 20;
  const x = align === 'right' ? anchorX - w : anchorX;
  roundRect(ctx, x, y - h / 2, w, h, h / 2);
  ctx.fillStyle = COLORS.primarySoft;
  ctx.fill();
  ctx.strokeStyle = COLORS.primaryRing;
  ctx.lineWidth = 1;
  ctx.stroke();
  drawText(ctx, text, x + w / 2, y + size * 0.34, { size, weight: 'bold', base: BODY, align: 'center', color: COLORS.primary });
}

function drawHeader(ctx, { rtl, brand, league, pill, W, logo }) {
  const pad = 58;
  const hexR = 23;
  const hexCx = rtl ? W - pad - hexR : pad + hexR;
  const hexCy = 76;
  drawBrandLogo(ctx, hexCx, hexCy, hexR, logo);

  const align = rtl ? 'right' : 'left';
  const textX = rtl ? hexCx - hexR - 16 : hexCx + hexR + 16;
  drawText(ctx, brand, textX, 70, { size: 24, weight: 'bold', base: HEAD, align, color: COLORS.textHi, maxWidth: 360 });
  drawText(ctx, league, textX, 96, { size: 14, weight: 'bold', base: BODY, align, color: COLORS.textMid, maxWidth: 360 });

  drawPill(ctx, pill, rtl ? pad : W - pad, 76, { align: rtl ? 'left' : 'right' });

  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, 128);
  ctx.lineTo(W - pad, 128);
  ctx.stroke();
}

function drawSurface(ctx, x, y, w, h, radius = 20) {
  roundRect(ctx, x, y, w, h, radius);
  ctx.fillStyle = COLORS.card;
  ctx.fill();
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawOptionalImageCircle(ctx, img, cx, cy, r) {
  if (!img) return false;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
  return true;
}

function drawAvatar(ctx, cx, cy, r, displayName, avatarImg) {
  ctx.beginPath();
  ctx.arc(cx, cy, r + 7, 0, Math.PI * 2);
  ctx.strokeStyle = COLORS.primaryRing;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2);
  ctx.strokeStyle = COLORS.lineStrong;
  ctx.lineWidth = 1;
  ctx.stroke();

  if (!drawOptionalImageCircle(ctx, avatarImg, cx, cy, r)) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, COLORS.cardAlt);
    g.addColorStop(1, COLORS.bg1);
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
    const letter = (String(displayName).trim()[0] || '?').toUpperCase();
    drawText(ctx, letter, cx, cy + r * 0.34, { size: Math.round(r * 0.95), weight: 'bold', base: HEAD, align: 'center', color: COLORS.textMid });
  }
}

function drawStatsChip(ctx, cx, y, text) {
  const w = textWidth(ctx, text, 16, '', BODY) + 34;
  const h = 34;
  roundRect(ctx, cx - w / 2, y - h / 2, w, h, h / 2);
  ctx.fillStyle = COLORS.chipBg;
  ctx.fill();
  ctx.strokeStyle = COLORS.chipBorder;
  ctx.lineWidth = 1;
  ctx.stroke();
  drawText(ctx, text, cx, y + 5, { size: 16, base: BODY, align: 'center', color: COLORS.textMid, maxWidth: w - 24 });
}

function rankPalette(rank) {
  if (rank === 1) return { bg: COLORS.primarySoft, border: COLORS.primaryRing, fg: COLORS.primary };
  if (rank <= 3) return { bg: COLORS.chipBg, border: COLORS.lineStrong, fg: COLORS.textHi };
  return { bg: COLORS.chipBg, border: COLORS.chipBorder, fg: COLORS.textMid };
}

function drawRankChip(ctx, x, cy, rank, size = 34) {
  const c = rankPalette(rank);
  roundRect(ctx, x, cy - size / 2, size, size, 9);
  ctx.fillStyle = c.bg;
  ctx.fill();
  ctx.strokeStyle = c.border;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  drawText(ctx, String(rank), x + size / 2, cy + 6, { size: 17, weight: 'bold', base: HEAD, align: 'center', color: c.fg });
}

function drawRankRow(ctx, x, cy, w, rank, club, rtl) {
  const size = 30;
  const gap = 12;
  const top3 = rank <= 3;
  roundRect(ctx, x, cy - 23, w, 46, 12);
  ctx.fillStyle = top3 ? COLORS.cardAlt : 'rgba(255,255,255,0.03)';
  ctx.fill();
  ctx.strokeStyle = top3 ? COLORS.lineStrong : COLORS.line;
  ctx.lineWidth = 1;
  ctx.stroke();
  if (rtl) {
    drawRankChip(ctx, x + w - size - 10, cy, rank, size);
    drawText(ctx, club, x + w - size - gap - 10, cy + 6, {
      size: 20,
      weight: top3 ? 'bold' : '',
      base: BODY,
      align: 'right',
      color: top3 ? COLORS.textHi : COLORS.textMid,
      maxWidth: w - size - gap - 22,
    });
  } else {
    drawRankChip(ctx, x + 10, cy, rank, size);
    drawText(ctx, club, x + size + gap + 10, cy + 6, {
      size: 20,
      weight: top3 ? 'bold' : '',
      base: BODY,
      align: 'left',
      color: top3 ? COLORS.textHi : COLORS.textMid,
      maxWidth: w - size - gap - 22,
    });
  }
}

function drawQrPlaceholder(ctx, x, y, size) {
  ctx.fillStyle = '#f3f6fb';
  roundRect(ctx, x, y, size, size, 8);
  ctx.fill();
  const pad = size * 0.1;
  const inner = size - pad * 2;
  const n = 11;
  const m = inner / n;
  ctx.fillStyle = '#0c1626';
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (rnd() > 0.5) ctx.fillRect(x + pad + c * m, y + pad + r * m, m * 0.92, m * 0.92);
    }
  }
  const finder = (fx, fy) => {
    ctx.fillStyle = '#0c1626';
    ctx.fillRect(fx, fy, m * 3, m * 3);
    ctx.fillStyle = '#f3f6fb';
    ctx.fillRect(fx + m * 0.6, fy + m * 0.6, m * 1.8, m * 1.8);
    ctx.fillStyle = '#0c1626';
    ctx.fillRect(fx + m * 1.1, fy + m * 1.1, m * 0.8, m * 0.8);
  };
  finder(x + pad, y + pad);
  finder(x + pad + inner - m * 3, y + pad);
  finder(x + pad, y + pad + inner - m * 3);
}

function drawOptionalQr(ctx, qrImg, x, y, size) {
  if (qrImg) {
    ctx.fillStyle = '#f3f6fb';
    roundRect(ctx, x, y, size, size, 8);
    ctx.fill();
    const p = size * 0.08;
    ctx.save();
    roundRect(ctx, x + p, y + p, size - 2 * p, size - 2 * p, 4);
    ctx.clip();
    ctx.drawImage(qrImg, x + p, y + p, size - 2 * p, size - 2 * p);
    ctx.restore();
  } else {
    drawQrPlaceholder(ctx, x, y, size);
  }
}

function drawFooter(ctx, { rtl, W, t, url, qr }) {
  const pad = 58;
  const stripY = 586;
  drawSurface(ctx, pad, stripY, W - pad * 2, 108, 18);

  const qrSize = 84;
  const qrX = rtl ? pad + 14 : W - pad - qrSize - 14;
  drawOptionalQr(ctx, qr, qrX, stripY + 12, qrSize);

  const lead = rtl ? W - pad - 22 : pad + 22;
  const align = rtl ? 'right' : 'left';
  const iconSize = 24;
  const y1 = 626;
  let leadTextX = lead;
  if (rtl) {
    drawDiscordIcon(ctx, lead - iconSize * 0.66, y1 - 7, iconSize, COLORS.discord);
    leadTextX = lead - iconSize - 14;
  } else {
    drawDiscordIcon(ctx, lead + iconSize * 0.66, y1 - 7, iconSize, COLORS.discord);
    leadTextX = lead + iconSize + 14;
  }
  drawText(ctx, t.footLead, leadTextX, y1, { size: 21, weight: 'bold', base: HEAD, align, color: COLORS.textHi, maxWidth: 600 });
  drawText(ctx, url, lead, 657, { size: 23, weight: 'bold', base: BODY, align, color: COLORS.primary, maxWidth: 640 });
  drawText(ctx, t.footSub, lead, 682, { size: 15, base: BODY, align, color: COLORS.textMid, maxWidth: 640 });
}

// ---------------------------------------------------------------------------
// Localized strings
// ---------------------------------------------------------------------------
const STR = {
  en: {
    brand: (c) => String(c || 'Esports Community').toUpperCase(),
    league: 'PREDICTION LEAGUE',
    pill: (s) => `EWC ${s} • PREDICTIONS`,
    subtitle: 'made their predictions',
    meta: (n, w) => `${n} champion pick${n === 1 ? '' : 's'} • +${w} weekly`,
    heading: 'SEASON CHAMPION PICKS',
    none: 'Predictions locked in',
    footLead: 'Make your picks in Discord',
    footSub: 'Join the community, submit your predictions, and compete.',
  },
  ar: {
    brand: () => 'مجتمع الرياضات الإلكترونية',
    league: 'دوري التوقعات',
    pill: (s) => `توقعات EWC ${s}`,
    subtitle: 'شارك بالتوقع',
    meta: (n, w) => `${n} توقع للأبطال • +${w} أسبوعية`,
    heading: 'توقعات أبطال الموسم',
    none: 'تم تسجيل التوقعات',
    footLead: 'توقعاتك داخل الديسكورد',
    footSub: 'انضم إلى المجتمع، سجّل توقعاتك، ونافس الآخرين.',
  },
};

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------
// `avatar` and `qr` are optional PNG Buffers. QR generation is left to the
// caller (pass a PNG buffer); when omitted a QR-style placeholder is drawn.
export async function renderEwcShareCard({
  displayName = 'Member',
  avatar = null,
  qr = null,
  seasonPicks = [],
  weeklyCount = 0,
  season = '2026',
  communityName = 'Esports Community',
  discordUrl = 'esportscommunity.net/discord',
  locale = 'en',
} = {}) {
  const rtl = locale === 'ar';
  const t = STR[rtl ? 'ar' : 'en'];
  const W = 1200;
  const H = 720;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'alphabetic';
  const brandLogo = await getBrandLogo();

  drawCardBackground(ctx, W, H);
  drawHeader(ctx, { rtl, brand: rtl ? t.brand() : t.brand(communityName), league: t.league, pill: t.pill(season), W, logo: brandLogo });

  const picks = (seasonPicks || []).filter((p) => typeof p === 'string' && p.trim()).slice(0, 10);

  let avatarImg = null;
  if (avatar) {
    try {
      avatarImg = await loadImage(avatar);
    } catch {
      avatarImg = null;
    }
  }
  let qrImg = null;
  if (qr) {
    try {
      qrImg = await loadImage(qr);
    } catch {
      qrImg = null;
    }
  }

  const pad = 58;
  const panelY = 158;
  const panelH = 392;
  const gap = 18;
  const profileW = 344;
  const rankW = W - pad * 2 - profileW - gap;
  const profileX = rtl ? W - pad - profileW : pad;
  const rankX = rtl ? pad : profileX + profileW + gap;
  drawSurface(ctx, profileX, panelY, profileW, panelH);
  drawSurface(ctx, rankX, panelY, rankW, panelH);

  // ---- Profile column (leading side) ----
  const profCx = profileX + profileW / 2;
  const avCy = 284;
  const avR = 78;
  drawAvatar(ctx, profCx, avCy, avR, displayName, avatarImg);
  drawText(ctx, displayName, profCx, avCy + avR + 48, { size: 33, weight: 'bold', base: HEAD, align: 'center', color: COLORS.textHi, maxWidth: profileW - 40 });
  drawText(ctx, t.subtitle, profCx, avCy + avR + 80, { size: 18, base: BODY, align: 'center', color: COLORS.textMid, maxWidth: profileW - 40 });
  drawStatsChip(ctx, profCx, avCy + avR + 120, t.meta(picks.length, weeklyCount));

  // ---- Rankings (trailing side) ----
  const accentX = rtl ? rankX + rankW - 38 : rankX + 34;
  roundRect(ctx, accentX, 180, 4, 26, 2);
  ctx.fillStyle = COLORS.primary;
  ctx.fill();
  const headX = rtl ? accentX - 16 : accentX + 18;
  const headAlign = rtl ? 'right' : 'left';
  drawText(ctx, t.heading, headX, 202, { size: 24, weight: 'bold', base: HEAD, align: headAlign, color: COLORS.textHi, maxWidth: rankW - 86 });

  if (picks.length) {
    const innerX = rankX + 30;
    const innerW = rankW - 60;
    const colGap = 22;
    const colW = Math.floor((innerW - colGap) / 2);
    const perCol = picks.length > 5 ? 5 : picks.length;
    const rowH = 52;
    const top = 256;
    const colLeft = (col) => (rtl ? innerX + innerW - colW - col * (colW + colGap) : innerX + col * (colW + colGap));
    picks.forEach((club, i) => {
      const col = Math.floor(i / perCol);
      const row = i % perCol;
      drawRankRow(ctx, colLeft(col), top + row * rowH, colW, i + 1, club, rtl);
    });
  } else {
    drawText(ctx, t.none, rankX + rankW / 2, 330, { size: 24, base: BODY, align: 'center', color: COLORS.textMid });
  }

  // ---- Footer action strip ----
  drawFooter(ctx, { rtl, W, t, url: discordUrl.replace(/^https?:\/\//, ''), qr: qrImg });

  return canvas.toBuffer('image/png');
}
