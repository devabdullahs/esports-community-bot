export const LEADERBOARD_PAGE_SIZE = 50;

const MAX_REQUESTED_PAGE = Math.floor(Number.MAX_SAFE_INTEGER / LEADERBOARD_PAGE_SIZE);

function normalizeRequestedPage(value: unknown) {
  const page = Math.floor(Number(value));
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(page, MAX_REQUESTED_PAGE);
}

function normalizeCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

export function getLeaderboardPageRequest(requestedPage: unknown) {
  const page = normalizeRequestedPage(requestedPage);
  return {
    page,
    limit: LEADERBOARD_PAGE_SIZE,
    offset: (page - 1) * LEADERBOARD_PAGE_SIZE,
  };
}

export function getLeaderboardPageModel({
  requestedPage,
  total,
  returnedRowCount,
}: {
  requestedPage: unknown;
  total: number;
  returnedRowCount: number;
}) {
  const safeTotal = normalizeCount(total);
  const totalPages = Math.max(1, Math.ceil(safeTotal / LEADERBOARD_PAGE_SIZE));
  const request = getLeaderboardPageRequest(requestedPage);
  const page = Math.min(request.page, totalPages);
  const offset = (page - 1) * LEADERBOARD_PAGE_SIZE;
  const rowCount = Math.min(
    normalizeCount(returnedRowCount),
    LEADERBOARD_PAGE_SIZE,
    Math.max(0, safeTotal - offset),
  );

  return {
    page,
    limit: LEADERBOARD_PAGE_SIZE,
    offset,
    totalPages,
    rangeStart: rowCount === 0 ? 0 : offset + 1,
    rangeEnd: rowCount === 0 ? 0 : offset + rowCount,
    hasPreviousPage: page > 1,
    hasNextPage: page < totalPages,
  };
}
