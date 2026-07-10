import { describe, expect, test } from "vitest";
import {
  getLeaderboardPageModel,
  getLeaderboardPageRequest,
  LEADERBOARD_PAGE_SIZE,
} from "@/lib/leaderboard-page-model";

describe("leaderboard page model", () => {
  test("uses a stable 50-row limit and offset", () => {
    expect(LEADERBOARD_PAGE_SIZE).toBe(50);
    expect(getLeaderboardPageRequest("3")).toEqual({
      page: 3,
      limit: 50,
      offset: 100,
    });
  });

  test("models an empty leaderboard", () => {
    expect(getLeaderboardPageModel({ requestedPage: "1", total: 0, returnedRowCount: 0 })).toEqual({
      page: 1,
      limit: 50,
      offset: 0,
      totalPages: 1,
      rangeStart: 0,
      rangeEnd: 0,
      hasPreviousPage: false,
      hasNextPage: false,
    });
  });

  test("models the first page", () => {
    expect(getLeaderboardPageModel({ requestedPage: "1", total: 123, returnedRowCount: 50 })).toMatchObject({
      page: 1,
      offset: 0,
      totalPages: 3,
      rangeStart: 1,
      rangeEnd: 50,
      hasPreviousPage: false,
      hasNextPage: true,
    });
  });

  test("models a middle page", () => {
    expect(getLeaderboardPageModel({ requestedPage: "2", total: 123, returnedRowCount: 50 })).toMatchObject({
      page: 2,
      offset: 50,
      totalPages: 3,
      rangeStart: 51,
      rangeEnd: 100,
      hasPreviousPage: true,
      hasNextPage: true,
    });
  });

  test("uses the actual returned row count on a final partial page", () => {
    expect(getLeaderboardPageModel({ requestedPage: "3", total: 123, returnedRowCount: 23 })).toMatchObject({
      page: 3,
      offset: 100,
      totalPages: 3,
      rangeStart: 101,
      rangeEnd: 123,
      hasPreviousPage: true,
      hasNextPage: false,
    });
  });

  test.each([undefined, "", "not-a-page", "0", "-4", Number.NaN, Number.POSITIVE_INFINITY])(
    "clamps invalid page %s to the first page",
    (requestedPage) => {
      expect(getLeaderboardPageModel({ requestedPage, total: 123, returnedRowCount: 50 })).toMatchObject({
        page: 1,
        offset: 0,
        rangeStart: 1,
        rangeEnd: 50,
      });
    },
  );

  test("clamps an over-range page to the final page", () => {
    expect(getLeaderboardPageModel({ requestedPage: "99", total: 123, returnedRowCount: 23 })).toMatchObject({
      page: 3,
      offset: 100,
      totalPages: 3,
      rangeStart: 101,
      rangeEnd: 123,
      hasPreviousPage: true,
      hasNextPage: false,
    });
  });
});
