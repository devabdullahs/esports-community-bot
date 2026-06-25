import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';

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
// Arabic must come from a real Arabic font — DejaVu/Inter have no Arabic glyphs (tofu).
// Docker installs fonts-noto-core (Noto Sans Arabic); dev (Windows) falls back to Segoe UI.
// Final fallback is the bare family name so fontconfig can resolve the installed font on
// Linux even when the exact file path differs across distro versions.
const ARABIC =
  sys('Noto Sans Arabic') ||
  sys('Noto Naskh Arabic') ||
  reg(
    [
      '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf',
      '/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf',
      '/usr/share/fonts/opentype/noto/NotoSansArabic-Regular.ttf',
      'C:/Windows/Fonts/segoeui.ttf',
    ],
    'EwcShareArabic',
  ) ||
  'Noto Sans Arabic';
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

// ---------------------------------------------------------------------------
// Palette — mature dark-navy + soft gold, muted steel-blue secondary text.
// ---------------------------------------------------------------------------
const COLORS = {
  bg0: '#101d31',
  bg1: '#070b14',
  panel: '#13223a',
  gold: '#d9b65d',
  goldDim: 'rgba(217,182,93,0.5)',
  goldFaint: 'rgba(217,182,93,0.08)',
  silver: '#ccd6e4',
  bronze: '#c08552',
  textHi: '#eef3fb',
  textMid: '#9aabc4',
  textLow: '#647592',
  line: 'rgba(154,171,196,0.12)',
  chipBg: '#152439',
  chipBorder: 'rgba(154,171,196,0.16)',
};

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
    ctx.font = `${weight ? `${weight} ` : ''}${size}px ${r.stack}`;
    r.width = ctx.measureText(r.text).width;
    width += r.width;
  }
  return { out, width };
}

// Draw mixed-script text with alignment ('left' anchors at x, 'right' ends at x, 'center' centers on x).
function drawText(ctx, text, x, y, { size, weight = '', base, align = 'left', color, maxWidth } = {}) {
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
    ctx.font = `${weight ? `${weight} ` : ''}${size}px ${r.stack}`;
    ctx.fillText(r.text, cursor, y);
    cursor += r.width;
  }
  return width;
}

function textWidth(ctx, text, size, weight, base) {
  return runs(ctx, text, size, weight, base).width;
}

// ---------------------------------------------------------------------------
// Component helpers
// ---------------------------------------------------------------------------
function hexPath(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI / 3) * i - Math.PI / 2; // pointy-top
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawHexLogo(ctx, cx, cy, r, label) {
  hexPath(ctx, cx, cy, r);
  const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  g.addColorStop(0, '#1c2d48');
  g.addColorStop(1, '#0c1626');
  ctx.fillStyle = g;
  ctx.fill();
  hexPath(ctx, cx, cy, r);
  ctx.strokeStyle = COLORS.gold;
  ctx.lineWidth = 2.4;
  ctx.stroke();
  drawText(ctx, label, cx, cy + r * 0.28, { size: Math.round(r * 0.72), weight: 'bold', base: HEAD, align: 'center', color: COLORS.gold });
}

// Simplified, monochrome Discord glyph (no emoji font dependency).
function drawDiscordIcon(ctx, cx, cy, size, color) {
  ctx.save();
  ctx.fillStyle = color;
  const w = size * 1.2;
  const h = size * 0.88;
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h * 0.42);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.18, cy + h * 0.32);
  ctx.lineTo(cx - w * 0.02, cy + h * 0.62);
  ctx.lineTo(cx + w * 0.14, cy + h * 0.32);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = COLORS.bg0;
  ctx.beginPath();
  ctx.ellipse(cx - w * 0.19, cy - h * 0.02, size * 0.1, size * 0.17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + w * 0.19, cy - h * 0.02, size * 0.1, size * 0.17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCardBackground(ctx, W, H) {
  const g = ctx.createLinearGradient(0, 0, W * 0.55, H);
  g.addColorStop(0, COLORS.bg0);
  g.addColorStop(1, COLORS.bg1);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Soft top-left glow.
  const rg = ctx.createRadialGradient(W * 0.16, H * 0.1, 0, W * 0.16, H * 0.1, W * 0.55);
  rg.addColorStop(0, 'rgba(70,104,150,0.12)');
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W, H);

  // Subtle diagonal texture.
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.016)';
  ctx.lineWidth = 1;
  for (let x = -H; x < W; x += 28) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + H, H);
    ctx.stroke();
  }
  ctx.restore();

  // Thin gold border + faint inner keyline.
  ctx.strokeStyle = COLORS.goldDim;
  ctx.lineWidth = 2;
  roundRect(ctx, 14, 14, W - 28, H - 28, 26);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(154,171,196,0.07)';
  ctx.lineWidth = 1;
  roundRect(ctx, 22, 22, W - 44, H - 44, 22);
  ctx.stroke();
}

function drawPill(ctx, text, anchorX, y, { align = 'right', size = 17 } = {}) {
  const w = textWidth(ctx, text, size, 'bold', BODY) + 36;
  const h = size + 20;
  const x = align === 'right' ? anchorX - w : anchorX;
  roundRect(ctx, x, y - h / 2, w, h, h / 2);
  ctx.fillStyle = COLORS.goldFaint;
  ctx.fill();
  ctx.strokeStyle = COLORS.goldDim;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  drawText(ctx, text, x + w / 2, y + size * 0.34, { size, weight: 'bold', base: BODY, align: 'center', color: COLORS.gold });
}

function drawHeader(ctx, { rtl, brand, league, pill, W }) {
  const pad = 58;
  const hexR = 23;
  const hexCx = rtl ? W - pad - hexR : pad + hexR;
  const hexCy = 76;
  drawHexLogo(ctx, hexCx, hexCy, hexR, 'EC');

  const align = rtl ? 'right' : 'left';
  const textX = rtl ? hexCx - hexR - 16 : hexCx + hexR + 16;
  drawText(ctx, brand, textX, 70, { size: 24, weight: 'bold', base: HEAD, align, color: COLORS.textHi, maxWidth: 360 });
  drawText(ctx, league, textX, 96, { size: 14, weight: 'bold', base: BODY, align, color: COLORS.gold, maxWidth: 360 });

  drawPill(ctx, pill, rtl ? pad : W - pad, 76, { align: rtl ? 'left' : 'right' });

  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, 128);
  ctx.lineTo(W - pad, 128);
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
  ctx.strokeStyle = COLORS.gold;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 2;
  ctx.stroke();

  if (!drawOptionalImageCircle(ctx, avatarImg, cx, cy, r)) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, '#21344f');
    g.addColorStop(1, '#0f1c2e');
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
  if (rank === 1) return { bg: 'rgba(217,182,93,0.16)', border: COLORS.gold, fg: COLORS.gold };
  if (rank === 2) return { bg: 'rgba(204,214,228,0.13)', border: COLORS.silver, fg: COLORS.silver };
  if (rank === 3) return { bg: 'rgba(192,133,82,0.16)', border: COLORS.bronze, fg: COLORS.bronze };
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
  const size = 34;
  const gap = 14;
  const top3 = rank <= 3;
  if (rtl) {
    drawRankChip(ctx, x + w - size, cy, rank, size);
    drawText(ctx, club, x + w - size - gap, cy + 6, {
      size: 22,
      weight: top3 ? 'bold' : '',
      base: BODY,
      align: 'right',
      color: top3 ? COLORS.textHi : COLORS.textMid,
      maxWidth: w - size - gap,
    });
  } else {
    drawRankChip(ctx, x, cy, rank, size);
    drawText(ctx, club, x + size + gap, cy + 6, {
      size: 22,
      weight: top3 ? 'bold' : '',
      base: BODY,
      align: 'left',
      color: top3 ? COLORS.textHi : COLORS.textMid,
      maxWidth: w - size - gap,
    });
  }
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, cy + 24);
  ctx.lineTo(x + w, cy + 24);
  ctx.stroke();
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
  const dividerY = 588;
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, dividerY);
  ctx.lineTo(W - pad, dividerY);
  ctx.stroke();

  const qrSize = 84;
  const qrX = rtl ? pad : W - pad - qrSize;
  drawOptionalQr(ctx, qr, qrX, 604, qrSize);

  const lead = rtl ? W - pad : pad;
  const align = rtl ? 'right' : 'left';
  const iconSize = 20;
  const y1 = 636;
  let leadTextX = lead;
  if (rtl) {
    drawDiscordIcon(ctx, lead - iconSize * 0.6, y1 - 7, iconSize, COLORS.gold);
    leadTextX = lead - iconSize - 14;
  } else {
    drawDiscordIcon(ctx, lead + iconSize * 0.6, y1 - 7, iconSize, COLORS.gold);
    leadTextX = lead + iconSize + 14;
  }
  drawText(ctx, t.footLead, leadTextX, y1, { size: 21, weight: 'bold', base: HEAD, align, color: COLORS.textHi, maxWidth: 600 });
  drawText(ctx, url, lead, 668, { size: 23, weight: 'bold', base: BODY, align, color: COLORS.gold, maxWidth: 640 });
  drawText(ctx, t.footSub, lead, 695, { size: 15, base: BODY, align, color: COLORS.textMid, maxWidth: 640 });
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
    brand: () => 'مجتمع الإيسبورتس',
    league: 'دوري التوقعات',
    pill: (s) => `توقعات EWC ${s}`,
    subtitle: 'شارك توقعاته',
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

  drawCardBackground(ctx, W, H);
  drawHeader(ctx, { rtl, brand: rtl ? t.brand() : t.brand(communityName), league: t.league, pill: t.pill(season), W });

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

  // ---- Profile column (leading side) ----
  const profCx = rtl ? W - 232 : 232;
  const avCy = 300;
  const avR = 90;
  drawAvatar(ctx, profCx, avCy, avR, displayName, avatarImg);
  drawText(ctx, displayName, profCx, avCy + avR + 54, { size: 33, weight: 'bold', base: HEAD, align: 'center', color: COLORS.textHi, maxWidth: 372 });
  drawText(ctx, t.subtitle, profCx, avCy + avR + 86, { size: 18, base: BODY, align: 'center', color: COLORS.textMid, maxWidth: 372 });
  drawStatsChip(ctx, profCx, avCy + avR + 126, t.meta(picks.length, weeklyCount));

  // Vertical divider between profile and rankings.
  const divX = rtl ? W - 432 : 432;
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(divX, 168);
  ctx.lineTo(divX, 556);
  ctx.stroke();

  // ---- Rankings (trailing side) ----
  const headX = rtl ? 730 : 470;
  const headAlign = rtl ? 'right' : 'left';
  drawText(ctx, t.heading, headX, 196, { size: 23, weight: 'bold', base: HEAD, align: headAlign, color: COLORS.gold });
  ctx.strokeStyle = COLORS.goldDim;
  ctx.lineWidth = 2;
  ctx.beginPath();
  const ulW = 54;
  ctx.moveTo(rtl ? headX - ulW : headX, 212);
  ctx.lineTo(rtl ? headX : headX + ulW, 212);
  ctx.stroke();

  if (picks.length) {
    const colW = 300;
    const colGap = 40;
    const perCol = picks.length > 5 ? 5 : picks.length;
    const rowH = 56;
    const top = 262;
    const colLeft = (col) => (rtl ? 430 - col * (colW + colGap) : 470 + col * (colW + colGap));
    picks.forEach((club, i) => {
      const col = Math.floor(i / perCol);
      const row = i % perCol;
      drawRankRow(ctx, colLeft(col), top + row * rowH, colW, i + 1, club, rtl);
    });
  } else {
    drawText(ctx, t.none, headX, 286, { size: 24, base: BODY, align: headAlign, color: COLORS.textMid });
  }

  // ---- Footer action strip ----
  drawFooter(ctx, { rtl, W, t, url: discordUrl.replace(/^https?:\/\//, ''), qr: qrImg });

  return canvas.toBuffer('image/png');
}
