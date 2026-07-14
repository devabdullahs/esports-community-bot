import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_NOTIFICATION_TIMEZONE,
  dmNotBefore,
  isQuietAt,
  isValidIanaTimezone,
  nextDigestTime,
  nextQuietEnd,
  normalizeNotificationSchedule,
} from '../src/lib/notificationSchedule.js';

const utc = (year, month, day, hour, minute = 0) => Math.floor(Date.UTC(year, month - 1, day, hour, minute) / 1000);

test('quiet hours cross midnight in Asia/Riyadh and release at the local end minute', () => {
  const prefs = { timezone: 'Asia/Riyadh', quiet_start_minute: 23 * 60, quiet_end_minute: 7 * 60 };
  const now = utc(2026, 1, 2, 21, 30); // 00:30 on Jan 3 in Riyadh
  assert.equal(isQuietAt(now, prefs), true);
  assert.equal(nextQuietEnd(now, prefs), utc(2026, 1, 3, 4)); // 07:00 Riyadh
  assert.equal(dmNotBefore(now, prefs), utc(2026, 1, 3, 4));
});

test('equal or incomplete quiet boundaries are disabled', () => {
  const now = utc(2026, 1, 2, 21, 30);
  assert.equal(isQuietAt(now, { quiet_start_minute: 90, quiet_end_minute: 90 }), false);
  assert.equal(isQuietAt(now, { quiet_start_minute: 90, quiet_end_minute: null }), false);
  assert.equal(nextQuietEnd(now, { quiet_start_minute: 90, quiet_end_minute: 90 }), null);
});

test('quiet-end conversion remains correct on DST transitions', () => {
  const prefs = { timezone: 'America/New_York', quiet_start_minute: 60, quiet_end_minute: 120 };
  const springBefore = utc(2026, 3, 8, 6, 30); // 01:30 EST, clocks jump to 03:00
  assert.equal(isQuietAt(springBefore, prefs), true);
  assert.equal(nextQuietEnd(springBefore, prefs), utc(2026, 3, 8, 7));

  const fallBefore = utc(2026, 11, 1, 5, 30); // first 01:30, end is 02:00 EST
  assert.equal(isQuietAt(fallBefore, prefs), true);
  assert.equal(nextQuietEnd(fallBefore, prefs), utc(2026, 11, 1, 7));
});

test('daily digest waits until quiet hours end when the digest minute is muted', () => {
  const prefs = {
    timezone: 'Asia/Riyadh',
    dm_delivery_mode: 'daily_digest',
    digest_minute: 18 * 60,
    quiet_start_minute: 17 * 60,
    quiet_end_minute: 19 * 60,
  };
  const now = utc(2026, 1, 2, 10); // 13:00 Riyadh
  assert.equal(nextDigestTime(now, prefs), utc(2026, 1, 2, 16)); // 19:00 Riyadh
  assert.equal(dmNotBefore(now, prefs), utc(2026, 1, 2, 16));
});

test('invalid timezones fall back only in scheduling code', () => {
  assert.equal(isValidIanaTimezone('Not/A_Zone'), false);
  assert.equal(normalizeNotificationSchedule({ timezone: 'Not/A_Zone' }).timezone, DEFAULT_NOTIFICATION_TIMEZONE);
  assert.equal(normalizeNotificationSchedule({ timezone: 'Asia/Riyadh' }).digestMinute, 1080);
});
