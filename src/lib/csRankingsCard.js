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
  'RankHeading',
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
  'RankBody',
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

function fmtPoints(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function renderCsRankingsCard(data) {
  const W = 1200;
  const H = 1200;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#14243a');
  bg.addColorStop(1, '#070c16');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(241,196,15,0.75)';
  ctx.lineWidth = 3;
  roundRect(ctx, 14, 14, W - 28, H - 28, 28);
  ctx.stroke();

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 46px ${HEAD}`;
  ctx.fillText('Counter-Strike Valve Rankings', 64, 104);
  ctx.fillStyle = '#9fb3d1';
  ctx.font = `28px ${BODY}`;
  ctx.fillText(`${data.label}${data.date ? ` - ${data.date}` : ''}`, 64, 148);

  ctx.fillStyle = '#f1c40f';
  ctx.textAlign = 'right';
  ctx.font = `bold 34px ${HEAD}`;
  ctx.fillText('VRS', W - 64, 104);

  ctx.strokeStyle = 'rgba(130,160,210,0.18)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(54, 184);
  ctx.lineTo(W - 54, 184);
  ctx.stroke();

  const rows = data.standings.slice(0, 15);
  let y = 226;
  for (const row of rows) {
    ctx.fillStyle = row.rank % 2 ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.018)';
    roundRect(ctx, 54, y - 28, W - 108, 56, 8);
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#f1c40f';
    ctx.font = `bold 22px ${HEAD}`;
    ctx.fillText(`#${row.rank}`, 76, y);

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 22px ${HEAD}`;
    ctx.fillText(fit(ctx, row.team, 330, `bold 22px ${HEAD}`), 150, y);

    ctx.fillStyle = '#9fb3d1';
    ctx.font = `18px ${BODY}`;
    const global = row.globalRank && row.globalRank !== row.rank ? `Global #${row.globalRank}` : row.region || '';
    ctx.fillText(global, 500, y);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 20px ${HEAD}`;
    ctx.fillText(`${fmtPoints(row.points)} pts`, W - 80, y);

    if (row.roster?.length) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#8ea2c3';
      ctx.font = `16px ${BODY}`;
      ctx.fillText(fit(ctx, row.roster.slice(0, 5).join(', '), 560, `16px ${BODY}`), 150, y + 20);
    }
    y += 62;
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = '#9fb3d1';
  ctx.font = `20px ${BODY}`;
  ctx.fillText('Data from Liquipedia — CC-BY-SA 3.0', 64, H - 42);

  return canvas.toBuffer('image/png');
}
