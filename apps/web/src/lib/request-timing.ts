const SLOW_REQUEST_MS = Number(process.env.WEB_SLOW_REQUEST_MS || 1_000);

/**
 * Times a handler and logs the ones that took too long.
 *
 * The bot's internal calls were timing out against this app while the very same requests
 * completed successfully a second or two later, which says the handler was slow rather than
 * broken — but nothing recorded how slow, so every gateway timeout was unattributable. Log
 * the duration of anything past the threshold, and only that, so a healthy request costs one
 * subtraction and no output.
 */
export async function timed<T>(
  label: string,
  run: () => Promise<T>,
  // Callers that split one request into phases need a lower bar than the
  // whole-request default, or a request that is slow overall logs nothing
  // because no single phase crossed it on its own.
  thresholdMs: number = SLOW_REQUEST_MS,
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await run();
  } finally {
    const durationMs = Date.now() - startedAt;
    if (durationMs >= thresholdMs) {
      console.warn(JSON.stringify({ event: "slow-request", label, durationMs }));
    }
  }
}
