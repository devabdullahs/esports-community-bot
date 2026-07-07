import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { isEwcMatch, matchTag, matchTagEwc } from './games.js';
import { loadLogoImage } from './logoCache.js';
import { isLobbyMatch, matchLabel } from './render.js';

// Register heading/body fonts (best-effort across OSes; falls back to a generic family).
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
  'CardHeading',
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
  'CardBody',
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
const initials = (name) =>
  String(name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();

export function displayTeamName(name) {
  const s = String(name || 'TBD').replace(/\s+/g, ' ').trim();
  if (/^thunderdownunder$/i.test(s)) return 'Thunder Down Under';
  return s;
}

export function hasTwoTeamLayout(m) {
  const teamB = String(m?.team_b ?? m?.teamB ?? '').trim();
  if (!teamB || /^lobby$/i.test(teamB)) return false;
  // parseMatchInfo emits source-level calendar/event rows as "<game>:event:..."
  // with team_b holding a stage/detail label, not an opponent.
  const externalId = String(m?.external_id ?? m?.externalId ?? '');
  if (/^[^:]+:event:/i.test(externalId)) return false;
  return true;
}

function drawTeam(ctx, cx, cy, size, name, img) {
  name = displayTeamName(name);
  if (img) {
    const r = Math.min(size / img.width, size / img.height);
    const w = img.width * r;
    const h = img.height * r;
    const dx = cx - w / 2;
    const dy = cy - h / 2;
    drawLightLogoHalo(ctx, img, dx, dy, w, h);
    ctx.drawImage(img, dx, dy, w, h);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#cdd8ec';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold 60px ${HEAD}`;
    ctx.fillText(initials(name), cx, cy);
    ctx.textBaseline = 'alphabetic';
  }
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.fillText(fit(ctx, name || 'TBD', 380, `bold 38px ${HEAD}`), cx, cy + size / 2 + 48);
}

function drawSmallLogo(ctx, cx, cy, maxW, maxH, name, img) {
  if (maxH == null) maxH = maxW;
  const x = cx - maxW / 2;
  const y = cy - maxH / 2;

  ctx.save();
  if (img) {
    const r = Math.min(maxW / img.width, maxH / img.height);
    const w = img.width * r;
    const h = img.height * r;
    const dx = cx - w / 2;
    const dy = cy - h / 2;
    drawLightLogoHalo(ctx, img, dx, dy, w, h);
    ctx.shadowColor = 'rgba(255,255,255,0.2)';
    ctx.shadowBlur = 5;
    ctx.drawImage(img, dx, dy, w, h);
    ctx.restore();
    return;
  }

  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.beginPath();
  ctx.arc(cx, cy, maxH / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#cdd8ec';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold 22px ${HEAD}`;
  ctx.fillText(initials(name), cx, cy);
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

function drawLightLogoHalo(ctx, img, dx, dy, w, h) {
  const pad = 8;
  const mask = createCanvas(Math.ceil(w + pad * 2), Math.ceil(h + pad * 2));
  const mctx = mask.getContext('2d');
  for (const [ox, oy] of [
    [-2, 0],
    [2, 0],
    [0, -2],
    [0, 2],
    [-1, -1],
    [1, 1],
  ]) {
    mctx.drawImage(img, pad + ox, pad + oy, w, h);
  }
  mctx.globalCompositeOperation = 'source-in';
  mctx.fillStyle = 'rgba(255,255,255,0.42)';
  mctx.fillRect(0, 0, mask.width, mask.height);
  ctx.drawImage(mask, dx - pad, dy - pad);
}

export function formatRiyadhDateTime(sec) {
  if (!sec) return { date: 'Date TBD', time: 'Time TBD', text: 'Date TBD - Time TBD UTC+3' };
  const d = new Date(sec * 1000);
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Riyadh',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Riyadh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return { date, time, text: `${date} - ${time} UTC+3` };
}

// Render a match-result card to a PNG Buffer.
// m = { tournament, subtitle, timeText, scoreText, teamA, teamB, logoA, logoB, accent, nextText }
export async function renderMatchCard(m) {
  const W = 1200;
  const H = 600;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#15273f');
  bg.addColorStop(1, '#070c16');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = m.accent || 'rgba(120,150,200,0.30)';
  ctx.lineWidth = 3;
  roundRect(ctx, 14, 14, W - 28, H - 28, 28);
  ctx.stroke();

  // Header
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(fit(ctx, m.tournament || 'Match', 720, `bold 46px ${HEAD}`), 64, 104);
  if (m.subtitle) {
    ctx.fillStyle = '#9fb3d1';
    ctx.fillText(fit(ctx, m.subtitle, 720, `32px ${BODY}`), 64, 150);
  }
  if (m.timeText) {
    ctx.fillStyle = '#8ab4ff';
    ctx.textAlign = 'right';
    ctx.font = `bold 36px ${HEAD}`;
    ctx.fillText(m.timeText, W - 64, 104);
  }

  ctx.strokeStyle = 'rgba(130,160,210,0.18)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(54, 196);
  ctx.lineTo(W - 54, 196);
  ctx.stroke();

  const [logoA, logoB] = await Promise.all([loadLogoImage(m.logoA), loadLogoImage(m.logoB)]);
  drawTeam(ctx, 270, 380, 160, m.teamA, logoA);

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (m.teamB) {
    drawTeam(ctx, W - 270, 380, 160, m.teamB, logoB);
    ctx.font = `bold 120px ${HEAD}`;
    ctx.fillText(m.scoreText || 'VS', W / 2, 384);
  } else {
    ctx.font = `bold 76px ${HEAD}`;
    ctx.fillText(m.scoreText || m.timeText || 'LIVE', W - 330, 360);
    ctx.fillStyle = '#9fb3d1';
    ctx.font = `30px ${BODY}`;
    ctx.fillText('Event lobby', W - 330, 420);
  }
  ctx.textBaseline = 'alphabetic';

  if (m.nextText) {
    ctx.fillStyle = '#9fb3d1';
    ctx.textAlign = 'center';
    ctx.font = `24px ${BODY}`;
    ctx.fillText(fit(ctx, m.nextText, 1060, `24px ${BODY}`), W / 2, 572);
  }

  return canvas.toBuffer('image/png');
}

export async function renderScheduleCard({ title, subtitle, matches, accent, showGameTags = false }) {
  const W = 1200;
  const H = 600;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#14243a');
  bg.addColorStop(1, '#070c16');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = accent || 'rgba(88,101,242,0.65)';
  ctx.lineWidth = 3;
  roundRect(ctx, 14, 14, W - 28, H - 28, 28);
  ctx.stroke();

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(fit(ctx, title || 'Upcoming Matches', 760, `bold 46px ${HEAD}`), 64, 104);
  if (subtitle) {
    ctx.fillStyle = '#9fb3d1';
    ctx.fillText(fit(ctx, subtitle, 760, `32px ${BODY}`), 64, 150);
  }

  ctx.fillStyle = '#8ab4ff';
  ctx.textAlign = 'right';
  ctx.font = `bold 36px ${HEAD}`;
  ctx.fillText('SCHEDULE', W - 64, 104);

  ctx.strokeStyle = 'rgba(130,160,210,0.18)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(54, 184);
  ctx.lineTo(W - 54, 184);
  ctx.stroke();

  const rows = matches.slice(0, 5);
  const logoPairs = await Promise.all(rows.map((m) => Promise.all([loadLogoImage(m.logo_a), loadLogoImage(m.logo_b)])));

  rows.forEach((m, i) => {
    const y = 230 + i * 72;
    const time = formatRiyadhDateTime(m.scheduled_at);

    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.018)';
    roundRect(ctx, 54, y - 34, W - 108, 62, 10);
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#8ab4ff';
    ctx.font = `bold 22px ${HEAD}`;
    ctx.fillText(time.time, 78, y - 5);
    ctx.fillStyle = '#9fb3d1';
    ctx.font = `20px ${BODY}`;
    ctx.fillText(`${time.date} UTC+3`, 78, y + 20);

    const [logoA, logoB] = logoPairs[i];
    // Two real teams (a head-to-head bracket match — including lobby-scored games
    // like TFT at EWC, where each round is still Team vs Team) get the balanced
    // two-crest layout. A single-participant lobby/event keeps one crest + label.
    const twoTeams = hasTwoTeamLayout(m);
    const teamA = displayTeamName(m.team_a);

    if (twoTeams) {
      const teamB = displayTeamName(m.team_b);
      const separator = isLobbyMatch(m) ? '—' : 'VS';
      drawSmallLogo(ctx, 306, y - 3, 76, 44, m.team_a, logoA);
      drawSmallLogo(ctx, 908, y - 3, 76, 44, m.team_b, logoB);

      ctx.fillStyle = '#ffffff';
      ctx.font = `bold 25px ${HEAD}`;
      ctx.textAlign = 'left';
      ctx.fillText(fit(ctx, teamA, 195, `bold 25px ${HEAD}`), 350, y - 3);
      ctx.textAlign = 'right';
      ctx.fillText(fit(ctx, teamB, 205, `bold 25px ${HEAD}`), 850, y - 3);

      ctx.textAlign = 'center';
      ctx.font = `bold 34px ${HEAD}`;
      ctx.fillText(separator, W / 2, y - 2);
    } else {
      drawSmallLogo(ctx, 306, y - 3, 76, 44, m.team_a, logoA);
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold 25px ${HEAD}`;
      ctx.textAlign = 'left';
      const label = matchLabel({ ...m, team_a: teamA });
      ctx.fillText(fit(ctx, label, 760, `bold 25px ${HEAD}`), 350, y - 3);
    }

    if (m.tournament_name) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#8ea2c3';
      ctx.font = `17px ${BODY}`;
      const tag = showGameTags ? matchTag(m) : null;
      const tournament = tag ? `${tag} - ${m.tournament_name}` : m.tournament_name;
      ctx.fillText(fit(ctx, tournament, 430, `17px ${BODY}`), W / 2, y + 23);
    }
  });

  return canvas.toBuffer('image/png');
}

// Riyadh calendar-day key + display label for grouping the status card's
// upcoming list ("TODAY · MON 7 JUL" instead of a full date repeated per row).
function riyadhDayKey(sec) {
  if (!sec) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(sec * 1000));
}

function riyadhDayLabel(sec, nowMs) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Riyadh',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(sec * 1000));
  const key = riyadhDayKey(sec);
  const todayKey = riyadhDayKey(Math.floor(nowMs / 1000));
  const tomorrowKey = riyadhDayKey(Math.floor(nowMs / 1000) + 86400);
  const relative = key === todayKey ? 'TODAY · ' : key === tomorrowKey ? 'TOMORROW · ' : '';
  return `${relative}${parts.toUpperCase()}`;
}

// Fixed-width game-tag pill. EWC events get the gold treatment so the World Cup
// matches stand out from regular-circuit ones at a glance.
function drawTagPill(ctx, x, centerY, tag, { ewc = false, width = 170, height = 30 } = {}) {
  ctx.save();
  ctx.fillStyle = ewc ? 'rgba(241,196,15,0.14)' : 'rgba(88,101,242,0.16)';
  roundRect(ctx, x, centerY - height / 2, width, height, height / 2);
  ctx.fill();
  ctx.fillStyle = ewc ? '#f1c40f' : '#8ab4ff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(fit(ctx, tag || 'Game', width - 24, `bold 17px ${HEAD}`), x + width / 2, centerY + 1);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.restore();
}

export function renderAllGamesStatusCard({ live = [], upcoming = [], updatedAt = Date.now(), accent }) {
  const W = 1200;
  // Size the canvas to the CONTENT: fixed header + live section + one header
  // per upcoming day + one row per match + footer. The old fixed 920px height
  // silently dropped later days once the compact day-grouped layout landed.
  const HEADER_H = 44;
  const ROW_H = 46;
  const liveRows = live.slice(0, 4);
  const groups = new Map();
  for (const m of upcoming.slice(0, 12)) {
    const key = riyadhDayKey(m.scheduled_at) ?? 'tbd';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const upcomingMatches = [...groups.values()].reduce((sum, list) => sum + list.length, 0);
  const liveSectionH = liveRows.length ? liveRows.length * 50 : 66;
  const upcomingSectionH = groups.size
    ? groups.size * HEADER_H + upcomingMatches * ROW_H + 30
    : 80;
  const H = Math.max(600, 224 + 36 + liveSectionH + 56 + upcomingSectionH + 92);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#14243a');
  bg.addColorStop(1, '#070c16');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = accent || (live.length ? 'rgba(237,66,69,0.75)' : 'rgba(88,101,242,0.65)');
  ctx.lineWidth = 3;
  roundRect(ctx, 14, 14, W - 28, H - 28, 28);
  ctx.stroke();

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 46px ${HEAD}`;
  ctx.fillText('All Games Status', 64, 104);
  ctx.fillStyle = '#9fb3d1';
  ctx.font = `28px ${BODY}`;
  const updated = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Riyadh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(updatedAt));
  ctx.fillText(`Updated ${updated} UTC+3`, 64, 148);

  ctx.fillStyle = live.length ? '#ff6b72' : '#8ab4ff';
  ctx.textAlign = 'right';
  ctx.font = `bold 36px ${HEAD}`;
  ctx.fillText(live.length ? 'LIVE' : 'STANDBY', W - 64, 104);

  ctx.strokeStyle = 'rgba(130,160,210,0.18)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(54, 184);
  ctx.lineTo(W - 54, 184);
  ctx.stroke();

  let y = 224;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 28px ${HEAD}`;
  ctx.fillText(liveRows.length ? 'Live now' : 'No live matches', 64, y);

  y += 36;
  if (liveRows.length) {
    for (const m of liveRows) {
      // Plain tag: the pill's gold styling already marks EWC (no "- EWC" suffix).
      const tag = matchTag(m);
      const label = matchLabel(m);
      const score = m.score_a != null && m.score_b != null ? `${m.score_a} - ${m.score_b}` : 'Live';
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      roundRect(ctx, 54, y - 27, W - 108, 48, 10);
      ctx.fill();

      ctx.fillStyle = '#ff6b72';
      ctx.beginPath();
      ctx.arc(82, y - 4, 8, 0, Math.PI * 2);
      ctx.fill();

      drawTagPill(ctx, 104, y - 4, tag, { ewc: isEwcMatch(m) });

      ctx.fillStyle = '#ffffff';
      ctx.font = `bold 22px ${HEAD}`;
      ctx.fillText(fit(ctx, label, 640, `bold 22px ${HEAD}`), 296, y + 3);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#cdd8ec';
      ctx.font = `bold 22px ${HEAD}`;
      ctx.fillText(score, W - 82, y + 3);
      ctx.textAlign = 'left';
      y += 50;
    }
  } else {
    ctx.fillStyle = '#9fb3d1';
    ctx.font = `28px ${BODY}`;
    ctx.fillText('Cards will update here when tracked matches go live.', 64, y + 4);
    y += 66;
  }

  const nextY = y + 56;
  ctx.strokeStyle = 'rgba(130,160,210,0.18)';
  ctx.beginPath();
  ctx.moveTo(54, nextY - 42);
  ctx.lineTo(W - 54, nextY - 42);
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 28px ${HEAD}`;
  ctx.fillText('Upcoming', 64, nextY);

  // Group by Riyadh calendar day: one small day header ("TODAY · MON 7 JUL"),
  // then compact zebra rows showing only the TIME — instead of repeating the
  // full date on every line. Undated matches sort last under "DATE TBD".
  // (`groups`, HEADER_H, ROW_H are computed up top to size the canvas.)
  if (groups.size) {
    let rowY = nextY + 30;
    const bottom = H - 44;
    let zebra = 0;
    outer: for (const [key, matches] of groups) {
      if (rowY + HEADER_H > bottom) break;
      rowY += 12;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#7d92b5';
      ctx.font = `bold 18px ${HEAD}`;
      const label = key === 'tbd' ? 'DATE TBD' : riyadhDayLabel(matches[0].scheduled_at, updatedAt);
      ctx.fillText(label, 64, rowY + 14);
      ctx.strokeStyle = 'rgba(130,160,210,0.14)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(84 + ctx.measureText(label).width, rowY + 8);
      ctx.lineTo(W - 64, rowY + 8);
      ctx.stroke();
      rowY += HEADER_H - 12;

      for (const m of matches) {
        if (rowY + ROW_H > bottom) break outer;
        ctx.fillStyle = zebra % 2 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.016)';
        roundRect(ctx, 54, rowY, W - 108, ROW_H - 6, 10);
        ctx.fill();
        zebra += 1;
        const centerY = rowY + (ROW_H - 6) / 2;

        drawTagPill(ctx, 68, centerY, matchTag(m), { ewc: isEwcMatch(m) });

        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold 21px ${HEAD}`;
        ctx.fillText(fit(ctx, matchLabel(m), 700, `bold 21px ${HEAD}`), 262, centerY + 1);

        ctx.textAlign = 'right';
        ctx.fillStyle = '#8ab4ff';
        ctx.font = `bold 21px ${HEAD}`;
        const time = m.scheduled_at ? formatRiyadhDateTime(m.scheduled_at).time : 'TBD';
        ctx.fillText(time, W - 78, centerY + 1);
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';
        rowY += ROW_H;
      }
    }
    // One footer note replaces the per-row "UTC+3" repetition.
    ctx.textAlign = 'right';
    ctx.fillStyle = '#66799a';
    ctx.font = `16px ${BODY}`;
    ctx.fillText('All times UTC+3 (Riyadh)', W - 64, H - 34);
    ctx.textAlign = 'left';
  } else {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9fb3d1';
    ctx.font = `24px ${BODY}`;
    ctx.fillText('No upcoming matches found.', 64, nextY + 42);
  }

  return canvas.toBuffer('image/png');
}

export function renderStatusCard({ title, subtitle, statusText, detail, accent }) {
  const W = 1200;
  const H = 600;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#14243a');
  bg.addColorStop(1, '#070c16');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = accent || 'rgba(88,101,242,0.65)';
  ctx.lineWidth = 3;
  roundRect(ctx, 14, 14, W - 28, H - 28, 28);
  ctx.stroke();

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(fit(ctx, title || 'Match cards', 760, `bold 46px ${HEAD}`), 64, 104);
  if (subtitle) {
    ctx.fillStyle = '#9fb3d1';
    ctx.fillText(fit(ctx, subtitle, 760, `32px ${BODY}`), 64, 150);
  }

  ctx.fillStyle = '#8ab4ff';
  ctx.textAlign = 'right';
  ctx.font = `bold 36px ${HEAD}`;
  ctx.fillText('STANDBY', W - 64, 104);

  ctx.strokeStyle = 'rgba(130,160,210,0.18)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(54, 196);
  ctx.lineTo(W - 54, 196);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 78px ${HEAD}`;
  ctx.fillText(fit(ctx, statusText || 'No live matches', 960, `bold 78px ${HEAD}`), W / 2, 330);

  if (detail) {
    ctx.fillStyle = '#b5c5df';
    ctx.font = `32px ${BODY}`;
    ctx.fillText(fit(ctx, detail, 960, `32px ${BODY}`), W / 2, 410);
  }

  return canvas.toBuffer('image/png');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtUtc(sec) {
  const d = new Date(sec * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} - ${hh}:${mm} UTC`;
}

// Render a card from a DB match row (joined with tournament fields by getMatchesForGuild).
export function renderCardForMatch(m, { nextText } = {}) {
  // A two-team match (TFT/other lobby-scored games are still Team vs Team per round)
  // renders both crests; only a single-participant lobby collapses to one crest.
  const twoTeams = hasTwoTeamLayout(m);
  const lobby = isLobbyMatch(m);
  const tag = matchTagEwc(m);
  let timeText = '';
  let accent = 'rgba(120,150,200,0.35)';
  if (m.status === 'running') {
    timeText = 'LIVE';
    accent = 'rgba(237,66,69,0.75)';
  } else if (m.status === 'finished') {
    timeText = 'FINAL';
    accent = 'rgba(87,242,135,0.6)';
  } else if (m.scheduled_at) {
    timeText = fmtUtc(m.scheduled_at);
    accent = 'rgba(88,101,242,0.65)';
  }
  const hasScore = m.status !== 'scheduled' && m.score_a != null && m.score_b != null;
  let scoreText;
  if (hasScore) scoreText = `${m.score_a} : ${m.score_b}`;
  else if (twoTeams) scoreText = lobby ? '—' : 'VS';
  else scoreText = timeText || 'EVENT';
  return renderMatchCard({
    tournament: m.tournament_name || (tag ? `${tag} match` : 'Match'),
    subtitle: m.tournament_name && tag ? tag : null,
    timeText,
    scoreText,
    teamA: displayTeamName(m.team_a),
    teamB: twoTeams ? displayTeamName(m.team_b) : null,
    logoA: m.logo_a,
    logoB: m.logo_b,
    nextText,
    accent,
  });
}
