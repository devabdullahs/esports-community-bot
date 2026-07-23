export const LIQUIPEDIA_BACKOFF_ERROR_MESSAGE = 'Liquipedia: backing off after a rate limit';

function backoffError() {
  return new Error(LIQUIPEDIA_BACKOFF_ERROR_MESSAGE);
}

function floorAfter(timestamp, gapMs) {
  return timestamp > 0 ? timestamp + gapMs : 0;
}

// One in-process admission chain for every MediaWiki action. Persisted state
// covers restarts and coordination with the Liquipedia-hosted logo downloader.
export function createLiquipediaRequestScheduler({
  rateState,
  loadRateState,
  saveRateState,
  parseMinGapMs = 30_000,
  searchMinGapMs = 2_500,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const parseGapMs = Math.max(30_000, Number(parseMinGapMs) || 30_000);
  const searchGapMs = Math.max(2_500, Number(searchMinGapMs) || 2_500);
  let chain = Promise.resolve();

  async function admit(kind, task) {
    for (;;) {
      loadRateState({ force: true });
      if (now() < rateState.blockedUntil) throw backoffError();

      const earliestRequestAt = Math.max(
        floorAfter(rateState.lastRequestAt, searchGapMs),
        kind === 'parse' ? floorAfter(rateState.lastParseAt, parseGapMs) : 0,
      );
      const waitMs = earliestRequestAt - now();
      if (waitMs <= 0) break;
      await sleep(waitMs);
    }

    const requestedAt = now();
    rateState.lastRequestAt = requestedAt;
    if (kind === 'parse') rateState.lastParseAt = requestedAt;
    saveRateState();
    return task();
  }

  function schedule(kind, task) {
    if (kind !== 'parse' && kind !== 'search') throw new Error(`Unsupported Liquipedia request kind: ${kind}`);
    const run = chain.then(() => admit(kind, task));
    // Keep later admissions alive after a failed HTTP request or backoff rejection.
    chain = run.then(() => undefined, () => undefined);
    return run;
  }

  return { schedule };
}
