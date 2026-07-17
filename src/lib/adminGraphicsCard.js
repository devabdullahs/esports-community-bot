import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

function registerFont(paths, family) {
  for (const path of paths) {
    try {
      GlobalFonts.registerFromPath(path, family);
      return family;
    } catch {
      // Try the next OS-specific font path.
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
  'AdminGraphicsHeading',
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
  'AdminGraphicsBody',
);

const WIDTH = 1600;
const HEIGHT = 900;

function cleanText(value, fallback, maxLength = 100) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
  return text || fallback;
}

function fitText(ctx, value, maxWidth, font) {
  ctx.font = font;
  const text = cleanText(value, '', 180);
  if (ctx.measureText(text).width <= maxWidth) return text;
  let shortened = text;
  while (shortened.length > 1 && ctx.measureText(`${shortened}...`).width > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  return `${shortened}...`;
}

function roundedRect(ctx, x, y, width, height, radius = 20) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function initials(value) {
  return cleanText(value, '?', 60)
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();
}

function baseCanvas({ label, accent }) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#101820';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 18, HEIGHT);
  ctx.fillStyle = '#182632';
  roundedRect(ctx, 54, 50, WIDTH - 108, HEIGHT - 100, 24);
  ctx.fill();
  ctx.strokeStyle = '#2a3a47';
  ctx.lineWidth = 2;
  roundedRect(ctx, 54, 50, WIDTH - 108, HEIGHT - 100, 24);
  ctx.stroke();

  ctx.fillStyle = accent;
  ctx.font = `bold 25px ${HEAD}`;
  ctx.textAlign = 'left';
  ctx.fillText('EWC COMMUNITY', 104, 112);
  ctx.fillStyle = '#b9c7d2';
  ctx.font = `22px ${BODY}`;
  ctx.textAlign = 'right';
  ctx.fillText(label, WIDTH - 104, 112);
  ctx.strokeStyle = '#2a3a47';
  ctx.beginPath();
  ctx.moveTo(104, 142);
  ctx.lineTo(WIDTH - 104, 142);
  ctx.stroke();
  return { canvas, ctx };
}

function drawTeam(ctx, { x, y, name, accent }) {
  ctx.fillStyle = '#21323e';
  roundedRect(ctx, x, y, 490, 338, 20);
  ctx.fill();
  ctx.strokeStyle = '#324755';
  ctx.lineWidth = 2;
  roundedRect(ctx, x, y, 490, 338, 20);
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(x + 245, y + 135, 76, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#101820';
  ctx.font = `bold 64px ${HEAD}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials(name), x + 245, y + 140);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f7fbff';
  ctx.font = `bold 38px ${HEAD}`;
  ctx.fillText(fitText(ctx, name, 430, `bold 38px ${HEAD}`), x + 245, y + 278);
}

function renderMatchResult(input) {
  const { canvas, ctx } = baseCanvas({ label: 'MATCH RESULT', accent: '#1fc7b6' });
  const tournament = cleanText(input.tournament, 'Tournament', 90);
  ctx.fillStyle = '#f7fbff';
  ctx.textAlign = 'center';
  ctx.font = `bold 58px ${HEAD}`;
  ctx.fillText(fitText(ctx, tournament, 1280, `bold 58px ${HEAD}`), WIDTH / 2, 230);
  ctx.fillStyle = '#a9bbc9';
  ctx.font = `28px ${BODY}`;
  ctx.fillText(fitText(ctx, input.game, 800, `28px ${BODY}`), WIDTH / 2, 278);

  drawTeam(ctx, { x: 104, y: 350, name: input.teamA, accent: '#1fc7b6' });
  drawTeam(ctx, { x: 1006, y: 350, name: input.teamB, accent: '#f2a342' });
  ctx.fillStyle = '#101820';
  roundedRect(ctx, 645, 447, 310, 150, 20);
  ctx.fill();
  ctx.strokeStyle = '#415564';
  ctx.lineWidth = 2;
  roundedRect(ctx, 645, 447, 310, 150, 20);
  ctx.stroke();
  ctx.fillStyle = '#f7fbff';
  ctx.font = `bold 84px ${HEAD}`;
  ctx.textAlign = 'center';
  ctx.fillText(`${Number(input.scoreA)} - ${Number(input.scoreB)}`, WIDTH / 2, 550);
  return canvas.toBuffer('image/png');
}

function renderStandings(input) {
  const { canvas, ctx } = baseCanvas({ label: 'STANDINGS', accent: '#ea5f6a' });
  ctx.fillStyle = '#f7fbff';
  ctx.font = `bold 52px ${HEAD}`;
  ctx.textAlign = 'left';
  ctx.fillText(fitText(ctx, input.tournament, 1060, `bold 52px ${HEAD}`), 104, 228);
  ctx.fillStyle = '#a9bbc9';
  ctx.font = `26px ${BODY}`;
  ctx.fillText(fitText(ctx, input.section, 1060, `26px ${BODY}`), 104, 272);

  const rows = Array.isArray(input.entries) ? input.entries.slice(0, 6) : [];
  rows.forEach((entry, index) => {
    const y = 324 + index * 82;
    ctx.fillStyle = index % 2 === 0 ? '#21323e' : '#1c2b36';
    roundedRect(ctx, 104, y, WIDTH - 208, 64, 12);
    ctx.fill();
    ctx.fillStyle = index < 3 ? '#ea5f6a' : '#a9bbc9';
    ctx.font = `bold 28px ${HEAD}`;
    ctx.textAlign = 'center';
    ctx.fillText(String(Number(entry.rank) || index + 1), 150, y + 43);
    ctx.fillStyle = '#f7fbff';
    ctx.textAlign = 'left';
    ctx.fillText(fitText(ctx, entry.team, 870, `bold 28px ${HEAD}`), 204, y + 43);
    ctx.fillStyle = '#d6e3ec';
    ctx.textAlign = 'right';
    ctx.font = `bold 26px ${HEAD}`;
    ctx.fillText(fitText(ctx, entry.points || entry.extra || '-', 180, `bold 26px ${HEAD}`), WIDTH - 142, y + 43);
  });
  return canvas.toBuffer('image/png');
}

function renderNewsPromo(input) {
  const { canvas, ctx } = baseCanvas({ label: 'NEWS', accent: '#9c7de3' });
  ctx.fillStyle = '#9c7de3';
  roundedRect(ctx, 104, 198, 210, 42, 12);
  ctx.fill();
  ctx.fillStyle = '#101820';
  ctx.font = `bold 21px ${HEAD}`;
  ctx.textAlign = 'center';
  ctx.fillText(fitText(ctx, input.owner, 180, `bold 21px ${HEAD}`), 209, 226);

  const title = cleanText(input.title, 'Community update', 150);
  ctx.fillStyle = '#f7fbff';
  ctx.font = `bold 66px ${HEAD}`;
  ctx.textAlign = 'left';
  const words = title.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > 1220 && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  lines.slice(0, 3).forEach((value, index) => {
    ctx.fillText(fitText(ctx, value, 1220, `bold 66px ${HEAD}`), 104, 346 + index * 82);
  });

  ctx.fillStyle = '#b9c7d2';
  ctx.font = `32px ${BODY}`;
  const summary = cleanText(input.summary, '', 220);
  if (summary) {
    const summaryWords = summary.split(' ');
    let line = '';
    let lineIndex = 0;
    for (const word of summaryWords) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > 1220 && line) {
        ctx.fillText(line, 104, 650 + lineIndex * 44);
        line = word;
        lineIndex += 1;
        if (lineIndex === 2) break;
      } else {
        line = next;
      }
    }
    if (line && lineIndex < 2) ctx.fillText(fitText(ctx, line, 1220, `32px ${BODY}`), 104, 650 + lineIndex * 44);
  }
  return canvas.toBuffer('image/png');
}

// This renderer receives only already-resolved, finite template data. It has no
// image loading, network access, HTML parsing, SVG support, or font controls.
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
