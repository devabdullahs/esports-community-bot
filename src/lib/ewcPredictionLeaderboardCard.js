import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

function registerFont(paths, family) {
  for (const p of paths) {
    try {
      GlobalFonts.registerFromPath(p, family);
      return family;
    } catch {
      /* try next */
    }
  }
  return 'sans-serif';
}

function registerOptionalFont(paths, family) {
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

function systemFamily(name) {
  return GlobalFonts.families.some((font) => font.family === name) ? name : null;
}

const HEAD = registerFont(
  [
    'C:/Windows/Fonts/segoeuib.ttf',
    'C:/Windows/Fonts/arialbd.ttf',
    '/usr/share/fonts/opentype/inter/InterDisplay-Bold.otf',
    '/usr/share/fonts/opentype/inter/Inter-Bold.otf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/Library/Fonts/Arial Bold.ttf',
  ],
  'EwcPredictionHeading',
);
const BODY = registerFont(
  [
    'C:/Windows/Fonts/segoeui.ttf',
    'C:/Windows/Fonts/arial.ttf',
    '/usr/share/fonts/opentype/inter/Inter-Regular.otf',
    '/usr/share/fonts/opentype/inter/InterDisplay-Regular.otf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/Library/Fonts/Arial.ttf',
  ],
  'EwcPredictionBody',
);
const NOTO = systemFamily('Noto Sans') || registerOptionalFont(['/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf'], 'EwcPredictionNoto');
const ARABIC = systemFamily('Noto Sans Arabic') || registerOptionalFont(
  [
    '/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf',
    'C:/Windows/Fonts/segoeui.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  ],
  'EwcPredictionArabic',
);
const MATH = systemFamily('Noto Sans Math') || registerOptionalFont(
  [
    '/usr/share/fonts/truetype/noto/NotoSansMath-Regular.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansSymbols2-Regular.ttf',
    'C:/Windows/Fonts/seguisym.ttf',
  ],
  'EwcPredictionMath',
);
const SYMBOLS = systemFamily('Noto Sans Symbols2') || systemFamily('Noto Sans Symbols') || registerOptionalFont(
  [
    'C:/Windows/Fonts/seguisym.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansSymbols2-Regular.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansSymbols-Regular.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  ],
  'EwcPredictionSymbols',
);
const EMOJI = systemFamily('Noto Color Emoji') || registerOptionalFont(
  ['C:/Windows/Fonts/seguiemj.ttf', '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf'],
  'EwcPredictionEmoji',
);
const HISTORIC = systemFamily('Noto Sans Cuneiform') || registerOptionalFont(
  ['C:/Windows/Fonts/seguihis.ttf', '/usr/share/fonts/truetype/noto/NotoSansCuneiform-Regular.ttf'],
  'EwcPredictionHistoric',
);
const CJK = systemFamily('Noto Sans CJK JP') || registerOptionalFont(
  ['C:/Windows/Fonts/msgothic.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'],
  'EwcPredictionCjk',
);
const CJK_BOLD = systemFamily('Noto Sans CJK JP') || registerOptionalFont(
  ['C:/Windows/Fonts/YuGothB.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'],
  'EwcPredictionCjkBold',
);
const FALLBACKS = [
  NOTO,
  ARABIC,
  MATH,
  SYMBOLS,
  EMOJI,
  HISTORIC,
  CJK,
  CJK_BOLD,
].filter(Boolean);

function cssFamily(family) {
  if (!family || family.startsWith('"') || family.startsWith("'")) return family;
  return /[\s,]/.test(family) ? `"${family}"` : family;
}

function stack(family) {
  return [family, ...FALLBACKS.filter((fallback) => fallback !== family), 'sans-serif'].filter(Boolean).map(cssFamily).join(', ');
}

const HEAD_STACK = stack(HEAD);
const BODY_STACK = stack(BODY);

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fit(ctx, text, maxWidth, font) {
  ctx.font = font;
  let t = String(text ?? '');
  if (ctx.measureText(t).width <= maxWidth) return t;
  while (t.length > 1 && ctx.measureText(`${t}...`).width > maxWidth) t = t.slice(0, -1);
  return `${t}...`;
}

function stackForChar(ch, baseStack, weight = '') {
  const code = ch.codePointAt(0) || 0;
  if (code >= 0x12000 && code <= 0x123ff && HISTORIC) return stack(HISTORIC);
  if (code >= 0x1d400 && code <= 0x1d7ff && MATH) return stack(MATH);
  if (/\p{Script=Arabic}/u.test(ch) && ARABIC) return stack(ARABIC);
  if ((/[\u3040-\u30ff\u3400-\u9fff]/u.test(ch) || code >= 0x20000) && (weight === 'bold' ? CJK_BOLD || CJK : CJK)) {
    return stack(weight === 'bold' ? CJK_BOLD || CJK : CJK);
  }
  if (code > 0x7f && /\p{Emoji}/u.test(ch) && EMOJI) return stack(EMOJI);
  if (code > 0x7f && /\p{Script=Latin}/u.test(ch) && NOTO) return stack(NOTO);
  if (code > 0x7f && SYMBOLS) return stack(SYMBOLS);
  return baseStack;
}

function fontString(size, weight, familyStack) {
  return `${weight ? `${weight} ` : ''}${size}px ${familyStack}`;
}

function measureMixedText(ctx, text, style) {
  let width = 0;
  for (const ch of Array.from(String(text ?? ''))) {
    ctx.font = fontString(style.size, style.weight, stackForChar(ch, style.baseStack, style.weight));
    width += ctx.measureText(ch).width;
  }
  return width;
}

function fitMixedText(ctx, text, maxWidth, style) {
  const chars = Array.from(String(text ?? ''));
  if (measureMixedText(ctx, chars.join(''), style) <= maxWidth) return chars.join('');
  while (chars.length > 1 && measureMixedText(ctx, `${chars.join('')}...`, style) > maxWidth) chars.pop();
  return `${chars.join('')}...`;
}

function drawFitText(ctx, text, x, y, maxWidth, style) {
  const fitted = fitMixedText(ctx, text, maxWidth, style);
  let cursor = x;
  let run = '';
  let runStack = null;

  function flush() {
    if (!run) return;
    ctx.font = fontString(style.size, style.weight, runStack || style.baseStack);
    ctx.fillText(run, cursor, y);
    cursor += ctx.measureText(run).width;
    run = '';
  }

  for (const ch of Array.from(fitted)) {
    const nextStack = stackForChar(ch, style.baseStack, style.weight);
    if (run && nextStack !== runStack) flush();
    runStack = nextStack;
    run += ch;
  }
  flush();
}

function medal(rank) {
  if (rank === 1) return '#1';
  if (rank === 2) return '#2';
  if (rank === 3) return '#3';
  return `#${rank}`;
}

export function renderEwcPredictionLeaderboardCard({
  season = '2026',
  rows = [],
  participantLabels = [],
  participantCount = participantLabels.length,
  scoredWeeks = 0,
  totalWeeks = 0,
  bestWeeks = null,
  championPickVisible = false,
  updatedAt = Date.now(),
} = {}) {
  const W = 1200;
  const H = championPickVisible ? 1660 : 1280;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#14243a');
  bg.addColorStop(1, '#070c16');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(241,196,15,0.78)';
  ctx.lineWidth = 3;
  roundRect(ctx, 14, 14, W - 28, H - 28, 28);
  ctx.stroke();

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 46px ${HEAD_STACK}`;
  ctx.fillText(`EWC ${season} Prediction Leaderboard`, 64, 104);

  const updated = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Riyadh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(updatedAt));
  ctx.fillStyle = '#9fb3d1';
  ctx.font = `28px ${BODY_STACK}`;
  ctx.fillText(`Updated ${updated} UTC+3`, 64, 148);
  ctx.font = `22px ${BODY_STACK}`;
  ctx.fillText(bestWeeks ? `Overall counts best ${bestWeeks} weekly scores + season picks` : 'Overall counts all weekly scores + season picks', 64, 184);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#f1c40f';
  ctx.font = `bold 34px ${HEAD_STACK}`;
  ctx.fillText('PREDICTIONS', W - 64, 104);
  ctx.fillStyle = '#9fb3d1';
  ctx.font = `22px ${BODY_STACK}`;
  ctx.fillText(`Scored weeks ${scoredWeeks}/${totalWeeks || 0}`, W - 64, 148);
  ctx.fillText(bestWeeks ? `Best ${bestWeeks} weeks` : 'All weeks', W - 64, 184);

  ctx.strokeStyle = 'rgba(130,160,210,0.18)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(54, 220);
  ctx.lineTo(W - 54, 220);
  ctx.stroke();

  if (!rows.length) {
    ctx.textAlign = 'center';
    if (participantCount > 0) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold 46px ${HEAD_STACK}`;
      ctx.fillText(`Predicting now (${participantCount})`, W / 2, 520);
      ctx.fillStyle = '#9fb3d1';
      ctx.font = `24px ${BODY_STACK}`;
      ctx.fillText('Picks stay hidden until each game or season locks.', W / 2, 562);

      const visibleLabels = participantLabels.slice(0, 18);
      const chipW = 220;
      const chipH = 42;
      const gap = 12;
      const cols = 3;
      const startX = (W - cols * chipW - (cols - 1) * gap) / 2;
      let chipY = 612;
      visibleLabels.forEach((label, index) => {
        const col = index % cols;
        if (index > 0 && col === 0) chipY += chipH + gap;
        const chipX = startX + col * (chipW + gap);
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        roundRect(ctx, chipX, chipY - chipH + 8, chipW, chipH, 10);
        ctx.fill();
        ctx.textAlign = 'left';
        ctx.fillStyle = '#dce8ff';
        ctx.font = `bold 19px ${HEAD_STACK}`;
        drawFitText(ctx, label, chipX + 18, chipY - 9, chipW - 36, { size: 19, weight: 'bold', baseStack: HEAD_STACK });
      });
      if (participantCount > visibleLabels.length) {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#9fb3d1';
        ctx.font = `20px ${BODY_STACK}`;
        ctx.fillText(`+${participantCount - visibleLabels.length} more`, W / 2, chipY + 42);
      }

      ctx.textAlign = 'center';
      ctx.fillStyle = '#9fb3d1';
      ctx.font = `22px ${BODY_STACK}`;
      ctx.fillText('No scored predictions yet. Scores appear here after rounds are posted.', W / 2, 860);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold 46px ${HEAD_STACK}`;
      ctx.fillText('No scored predictions yet', W / 2, 590);
      ctx.fillStyle = '#9fb3d1';
      ctx.font = `26px ${BODY_STACK}`;
      ctx.fillText('The leaderboard will fill in when weekly or season scores are posted.', W / 2, 634);
    }
  } else {
    const rowStep = championPickVisible ? 64 : 48;
    const rowHeight = championPickVisible ? 58 : 44;
    const rowTop = championPickVisible ? 32 : 28;
    let y = championPickVisible ? 278 : 264;
    rows.slice(0, 20).forEach((row, index) => {
      const rank = index + 1;
      ctx.fillStyle = rank % 2 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.022)';
      roundRect(ctx, 54, y - rowTop, W - 108, rowHeight, 8);
      ctx.fill();

      ctx.textAlign = 'left';
      ctx.fillStyle = rank <= 3 ? '#f1c40f' : '#8ab4ff';
      ctx.font = `bold 22px ${HEAD_STACK}`;
      ctx.fillText(medal(rank), 76, championPickVisible ? y + 1 : y);

      ctx.fillStyle = '#ffffff';
      ctx.font = `bold 22px ${HEAD_STACK}`;
      drawFitText(
        ctx,
        row.label || `Member ${row.user_id}`,
        150,
        championPickVisible ? y - 8 : y,
        610,
        { size: 22, weight: 'bold', baseStack: HEAD_STACK },
      );
      if (championPickVisible) {
        ctx.fillStyle = '#9fb3d1';
        ctx.font = `17px ${BODY_STACK}`;
        drawFitText(ctx, `Champion pick: ${row.championPick || '-'}`, 150, y + 15, 670, { size: 17, weight: '', baseStack: BODY_STACK });
      }

      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold 22px ${HEAD_STACK}`;
      ctx.fillText(`${Number(row.score || 0).toLocaleString('en-US')} pts`, W - 80, championPickVisible ? y + 2 : y);
      y += rowStep;
    });
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = '#9fb3d1';
  ctx.font = `20px ${BODY_STACK}`;
  ctx.fillText('Weekly and season prediction points', 64, H - 42);

  return canvas.toBuffer('image/png');
}
