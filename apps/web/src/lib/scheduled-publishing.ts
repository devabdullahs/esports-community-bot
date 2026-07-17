import type { Locale } from "@/lib/i18n";

const RIYADH_TIME_ZONE = "Asia/Riyadh";
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

function parseStoredTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toRiyadhDateTimeInput(value: string | null | undefined): string {
  const date = parseStoredTimestamp(value);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: RIYADH_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

// The datetime-local control is intentionally Riyadh wall time, regardless of
// the editor's browser timezone. Saudi Arabia has no daylight-saving shift.
export function riyadhDateTimeToIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const wallClock = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    wallClock.getUTCFullYear() !== year ||
    wallClock.getUTCMonth() !== month - 1 ||
    wallClock.getUTCDate() !== day ||
    wallClock.getUTCHours() !== hour ||
    wallClock.getUTCMinutes() !== minute
  ) {
    return null;
  }
  return new Date(wallClock.getTime() - RIYADH_OFFSET_MS).toISOString();
}

export function formatScheduledPublishAt(value: string, locale: Locale): string {
  const date = parseStoredTimestamp(value);
  if (!date) return "";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: RIYADH_TIME_ZONE,
  }).format(date);
}

export function riyadhDayKey(value: string | null | undefined): string | null {
  return toRiyadhDateTimeInput(value).slice(0, 10) || null;
}

export function scheduledCalendarDate(value: string | null | undefined): Date | null {
  const key = riyadhDayKey(value);
  return key ? new Date(`${key}T12:00:00`) : null;
}
