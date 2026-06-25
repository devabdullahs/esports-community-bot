import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';

// Self-contained font setup (mirrors the paths in ewcPredictionLeaderboardCard.js).
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
const ARABIC =
  sys('Noto Sans Arabic') ||
  reg(
    [
      '/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf',
      '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf',
      'C:/Windows/Fonts/segoeui.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ],
    'EwcShareArabic',
  );
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
    // Truncate from the end until it fits (plus ellipsis).
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
}

const STR = {
  en: {
    title: (s) => `EWC ${s} · PREDICTIONS`,
    subtitle: 'made their predictions',
    seasonHeading: 'Season champion picks',
    weekly: (n) => `+ ${n} weekly game prediction${n === 1 ? '' : 's'}`,
    none: 'Predictions locked in',
    cta: 'Join the community & make your own',
  },
  ar: {
    title: (s) => `توقعات EWC ${s}`,
    subtitle: 'شارك بتوقعاته',
    seasonHeading: 'توقعات أبطال الموسم',
    weekly: (n) => `+ ${n} توقعات أسبوعية`,
    none: 'تم تسجيل التوقعات',
    cta: 'انضم إلى المجتمع وشارك بتوقعاتك',
  },
};

// Renders a shareable prediction card. `avatar` is an optional PNG Buffer.
export async function renderEwcShareCard({
  displayName = 'Member',
  avatar = null,
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

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#16273f');
  bg.addColorStop(1, '#070c16');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(241,196,15,0.8)';
  ctx.lineWidth = 4;
  roundRect(ctx, 16, 16, W - 32, H - 32, 30);
  ctx.stroke();

  const pad = 70;
  const lead = rtl ? W - pad : pad;
  const leadAlign = rtl ? 'right' : 'left';
  const trail = rtl ? pad : W - pad;
  const trailAlign = rtl ? 'left' : 'right';

  // Header
  drawText(ctx, communityName, lead, 96, { size: 40, weight: 'bold', base: HEAD, align: leadAlign, color: '#f1c40f', maxWidth: 560 });
  drawText(ctx, t.title(season), trail, 96, { size: 26, weight: 'bold', base: HEAD, align: trailAlign, color: '#9fb3d1' });
  ctx.strokeStyle = 'rgba(130,160,210,0.2)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(54, 130);
  ctx.lineTo(W - 54, 130);
  ctx.stroke();

  // Avatar block (leading side)
  const avX = rtl ? W - 230 : 230;
  const avY = 330;
  const r = 120;
  ctx.save();
  ctx.beginPath();
  ctx.arc(avX, avY, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  let drew = false;
  if (avatar) {
    try {
      const img = await loadImage(avatar);
      ctx.drawImage(img, avX - r, avY - r, r * 2, r * 2);
      drew = true;
    } catch {
      /* fall through to placeholder */
    }
  }
  if (!drew) {
    const g = ctx.createLinearGradient(avX - r, avY - r, avX + r, avY + r);
    g.addColorStop(0, '#2a4365');
    g.addColorStop(1, '#13233c');
    ctx.fillStyle = g;
    ctx.fillRect(avX - r, avY - r, r * 2, r * 2);
    ctx.fillStyle = '#9fb3d1';
    ctx.textAlign = 'center';
    ctx.font = `bold 96px ${q(HEAD)}`;
    ctx.fillText((displayName.trim()[0] || '?').toUpperCase(), avX, avY + 34);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(avX, avY, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#f1c40f';
  ctx.lineWidth = 6;
  ctx.stroke();

  drawText(ctx, displayName, avX, avY + r + 60, { size: 38, weight: 'bold', base: HEAD, align: 'center', color: '#ffffff', maxWidth: 380 });
  drawText(ctx, t.subtitle, avX, avY + r + 96, { size: 22, base: BODY, align: 'center', color: '#9fb3d1', maxWidth: 380 });

  // Picks panel (trailing side); two columns when >5 so a full top-10 never crowds the footer.
  const picks = (seasonPicks || []).filter((p) => typeof p === 'string' && p.trim()).slice(0, 10);
  const panelX = rtl ? W - 430 : 430;
  const panelAlign = rtl ? 'right' : 'left';
  const colGap = 360;
  drawText(ctx, t.seasonHeading, panelX, 200, { size: 30, weight: 'bold', base: HEAD, align: panelAlign, color: '#f1c40f' });

  if (picks.length) {
    const perCol = picks.length > 5 ? 5 : picks.length;
    const rowStep = 50;
    const listTop = 268;
    picks.forEach((club, i) => {
      const col = Math.floor(i / perCol);
      const row = i % perCol;
      const cx = rtl ? panelX - col * colGap : panelX + col * colGap;
      const cy = listTop + row * rowStep;
      const line = rtl ? `${club} .${i + 1}` : `${i + 1}. ${club}`;
      drawText(ctx, line, cx, cy, { size: 27, weight: i < 3 ? 'bold' : '', base: BODY, align: panelAlign, color: i < 3 ? '#ffffff' : '#cfe0f7', maxWidth: 300 });
    });
    if (weeklyCount > 0) {
      drawText(ctx, t.weekly(weeklyCount), panelX, listTop + perCol * rowStep + 8, { size: 22, base: BODY, align: panelAlign, color: '#9fb3d1' });
    }
  } else {
    drawText(ctx, t.none, panelX, 296, { size: 26, base: BODY, align: panelAlign, color: '#9fb3d1' });
  }

  // Footer CTA
  ctx.strokeStyle = 'rgba(130,160,210,0.2)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(54, H - 96);
  ctx.lineTo(W - 54, H - 96);
  ctx.stroke();
  drawText(ctx, t.cta, lead, H - 50, { size: 24, base: BODY, align: leadAlign, color: '#cfe0f7', maxWidth: 620 });
  drawText(ctx, `🔗 ${discordUrl}`, trail, H - 50, { size: 28, weight: 'bold', base: HEAD, align: trailAlign, color: '#f1c40f' });

  return canvas.toBuffer('image/png');
}
