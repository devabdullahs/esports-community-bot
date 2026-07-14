export const DEFAULT_NOTIFICATION_TIMEZONE = 'Asia/Riyadh';
export const DEFAULT_DIGEST_MINUTE = 18 * 60;

const MAX_TIMEZONE_LENGTH = 64;
const MAX_FORMATTERS = 64;
const formatterCache = new Map();

function wholeMinute(value, fallback = null) {
  const minute = Number(value);
  return Number.isInteger(minute) && minute >= 0 && minute < 24 * 60 ? minute : fallback;
}

export function isValidIanaTimezone(value) {
  if (typeof value !== 'string') return false;
  const timezone = value.trim();
  if (!timezone || timezone.length > MAX_TIMEZONE_LENGTH) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function normalizeNotificationTimezone(value) {
  return isValidIanaTimezone(value) ? value.trim() : DEFAULT_NOTIFICATION_TIMEZONE;
}

function formatterFor(timezone) {
  const normalized = normalizeNotificationTimezone(timezone);
  const existing = formatterCache.get(normalized);
  if (existing) return existing;
  if (formatterCache.size >= MAX_FORMATTERS) formatterCache.clear();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: normalized,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  formatterCache.set(normalized, formatter);
  return formatter;
}

function localParts(nowSec, timezone) {
  const values = {};
  for (const part of formatterFor(timezone).formatToParts(new Date(Math.floor(nowSec) * 1000))) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return values;
}

function localWallSecond(parts) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0) / 1000);
}

function localMinute(parts) {
  return parts.hour * 60 + parts.minute;
}

function addLocalDays(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function targetWallParts(date, minute) {
  return {
    ...date,
    hour: Math.floor(minute / 60),
    minute: minute % 60,
    second: 0,
  };
}

// Intl does not expose a wall-time-to-instant primitive. Iterate to the nearby
// offset, then scan a small DST-safe window for the first valid local minute.
function instantForWallTime(target, timezone) {
  const targetWall = localWallSecond(target);
  let estimate = targetWall;
  for (let i = 0; i < 6; i += 1) {
    const actualWall = localWallSecond(localParts(estimate, timezone));
    const delta = targetWall - actualWall;
    if (!delta) break;
    estimate += delta;
  }
  const start = Math.floor((estimate - 4 * 60 * 60) / 60) * 60;
  const end = estimate + 4 * 60 * 60;
  for (let instant = start; instant <= end; instant += 60) {
    if (localWallSecond(localParts(instant, timezone)) >= targetWall) return instant;
  }
  // This is unreachable for supported IANA zones, but keeps enqueueing durable
  // notifications even if a platform's timezone data behaves unexpectedly.
  return Math.floor(estimate / 60) * 60;
}

export function normalizeNotificationSchedule(prefs = {}) {
  const start = wholeMinute(prefs.quiet_start_minute ?? prefs.quietStartMinute);
  const end = wholeMinute(prefs.quiet_end_minute ?? prefs.quietEndMinute);
  const quietEnabled = start !== null && end !== null && start !== end;
  return {
    timezone: normalizeNotificationTimezone(prefs.timezone),
    quietStartMinute: quietEnabled ? start : null,
    quietEndMinute: quietEnabled ? end : null,
    digestMinute: wholeMinute(prefs.digest_minute ?? prefs.digestMinute, DEFAULT_DIGEST_MINUTE),
    dmDeliveryMode: prefs.dm_delivery_mode === 'daily_digest' || prefs.dmDeliveryMode === 'daily_digest'
      ? 'daily_digest'
      : 'instant',
  };
}

export function isQuietAt(nowSec, prefs = {}) {
  const schedule = normalizeNotificationSchedule(prefs);
  if (schedule.quietStartMinute === null || schedule.quietEndMinute === null) return false;
  const minute = localMinute(localParts(nowSec, schedule.timezone));
  if (schedule.quietStartMinute < schedule.quietEndMinute) {
    return minute >= schedule.quietStartMinute && minute < schedule.quietEndMinute;
  }
  return minute >= schedule.quietStartMinute || minute < schedule.quietEndMinute;
}

export function nextQuietEnd(nowSec, prefs = {}) {
  const schedule = normalizeNotificationSchedule(prefs);
  if (!isQuietAt(nowSec, schedule)) return null;
  const current = localParts(nowSec, schedule.timezone);
  const minute = localMinute(current);
  let date = { year: current.year, month: current.month, day: current.day };
  if (schedule.quietStartMinute > schedule.quietEndMinute && minute >= schedule.quietStartMinute) {
    date = addLocalDays(current, 1);
  }
  return instantForWallTime(targetWallParts(date, schedule.quietEndMinute), schedule.timezone);
}

export function nextDigestTime(nowSec, prefs = {}) {
  const schedule = normalizeNotificationSchedule(prefs);
  const current = localParts(nowSec, schedule.timezone);
  const currentMinute = localMinute(current);
  const atExactDigestMinute = currentMinute === schedule.digestMinute && current.second === 0;
  let date = { year: current.year, month: current.month, day: current.day };
  if (currentMinute > schedule.digestMinute || (currentMinute === schedule.digestMinute && !atExactDigestMinute)) {
    date = addLocalDays(current, 1);
  }
  const digestAt = instantForWallTime(targetWallParts(date, schedule.digestMinute), schedule.timezone);
  return nextQuietEnd(digestAt, schedule) ?? digestAt;
}

export function dmNotBefore(nowSec, prefs = {}) {
  const now = Math.floor(Number(nowSec));
  if (!Number.isFinite(now)) throw new Error('dmNotBefore requires a unix-seconds nowSec.');
  const schedule = normalizeNotificationSchedule(prefs);
  if (schedule.dmDeliveryMode === 'daily_digest') return nextDigestTime(now, schedule);
  return nextQuietEnd(now, schedule) ?? now;
}
