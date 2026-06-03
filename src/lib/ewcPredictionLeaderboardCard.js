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

function medal(rank) {
  if (rank === 1) return '#1';
  if (rank === 2) return '#2';
  if (rank === 3) return '#3';
  return `#${rank}`;
}

export function renderEwcPredictionLeaderboardCard({
  season = '2026',
  rows = [],
  scoredWeeks = 0,
  totalWeeks = 0,
  updatedAt = Date.now(),
} = {}) {
  const W = 1200;
  const H = 1200;
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
  ctx.font = `bold 46px ${HEAD}`;
  ctx.fillText(`EWC ${season} Prediction Leaderboard`, 64, 104);

  const updated = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Riyadh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(updatedAt));
  ctx.fillStyle = '#9fb3d1';
  ctx.font = `28px ${BODY}`;
  ctx.fillText(`Updated ${updated} UTC+3`, 64, 148);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#f1c40f';
  ctx.font = `bold 34px ${HEAD}`;
  ctx.fillText('PREDICTIONS', W - 64, 104);
  ctx.fillStyle = '#9fb3d1';
  ctx.font = `22px ${BODY}`;
  ctx.fillText(`Scored weeks ${scoredWeeks}/${totalWeeks || 0}`, W - 64, 148);

  ctx.strokeStyle = 'rgba(130,160,210,0.18)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(54, 184);
  ctx.lineTo(W - 54, 184);
  ctx.stroke();

  if (!rows.length) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 46px ${HEAD}`;
    ctx.fillText('No scored predictions yet', W / 2, 560);
    ctx.fillStyle = '#9fb3d1';
    ctx.font = `26px ${BODY}`;
    ctx.fillText('The leaderboard will fill in when weekly or season scores are posted.', W / 2, 604);
  } else {
    let y = 226;
    rows.slice(0, 20).forEach((row, index) => {
      const rank = index + 1;
      ctx.fillStyle = rank % 2 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.022)';
      roundRect(ctx, 54, y - 28, W - 108, 44, 8);
      ctx.fill();

      ctx.textAlign = 'left';
      ctx.fillStyle = rank <= 3 ? '#f1c40f' : '#8ab4ff';
      ctx.font = `bold 22px ${HEAD}`;
      ctx.fillText(medal(rank), 76, y);

      ctx.fillStyle = '#ffffff';
      ctx.font = `bold 22px ${HEAD}`;
      ctx.fillText(fit(ctx, row.label || `Member ${row.user_id}`, 620, `bold 22px ${HEAD}`), 150, y);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold 22px ${HEAD}`;
      ctx.fillText(`${Number(row.score || 0).toLocaleString('en-US')} pts`, W - 80, y);
      y += 48;
    });
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = '#9fb3d1';
  ctx.font = `20px ${BODY}`;
  ctx.fillText('Weekly and season prediction points', 64, H - 42);

  return canvas.toBuffer('image/png');
}
