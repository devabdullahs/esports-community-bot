export function isSnowflake(value: unknown): value is string {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

export function isSeason(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}$/.test(value);
}

export function clampInt(
  value: unknown,
  { min, max, fallback }: { min: number; max: number; fallback: number },
) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
