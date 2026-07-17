import { afterEach, describe, expect, test, vi } from "vitest";
import {
  riyadhDateTimeToIso,
  riyadhDayKey,
  toRiyadhDateTimeInput,
} from "@/lib/scheduled-publishing";
import { adminNavSections } from "@/lib/admin-navigation-model";
import { validateNewsInput } from "@/lib/news-validation";

describe("scheduled publishing time helpers", () => {
  afterEach(() => vi.useRealTimers());
  test("converts a Riyadh wall-clock value to UTC and back", () => {
    expect(riyadhDateTimeToIso("2099-02-03T13:15")).toBe("2099-02-03T10:15:00.000Z");
    expect(toRiyadhDateTimeInput("2099-02-03 10:15:00")).toBe("2099-02-03T13:15");
    expect(riyadhDayKey("2099-02-03 10:15:00")).toBe("2099-02-03");
  });

  test("rejects malformed calendar values", () => {
    expect(riyadhDateTimeToIso("2099-02-30T13:15")).toBeNull();
    expect(riyadhDateTimeToIso("not-a-date")).toBeNull();
  });

  test("rejects a sub-second future value that normalizes to an already-due second", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T10:00:00.200Z"));
    const result = validateNewsInput({
      gameSlug: "valorant",
      status: "scheduled",
      scheduledPublishAt: "2030-01-01T10:00:00.600Z",
      contentMode: "shared",
      defaultLocale: "en",
      translations: { en: { title: "Headline", summary: "", body: "Body" } },
    });
    expect(result.ok).toBe(false);
  });
});

test("scheduled posts require a publish-ready future timestamp", () => {
  const base = {
    gameSlug: "valorant",
    status: "scheduled",
    contentMode: "shared",
    defaultLocale: "en",
    translations: { en: { title: "Headline", summary: "", body: "Body" } },
  };
  expect(validateNewsInput(base).ok).toBe(false);
  expect(validateNewsInput({ ...base, scheduledPublishAt: "2000-01-01T00:00:00.000Z" }).ok).toBe(false);
  const valid = validateNewsInput({ ...base, scheduledPublishAt: "2099-02-03T10:15:00.000Z" });
  expect(valid.ok).toBe(true);
  if (valid.ok) expect(valid.value.scheduledPublishAt).toBe("2099-02-03 10:15:00");
});

test("scoped admins receive the editorial calendar navigation entry", () => {
  const items = adminNavSections("en", false, true, false).flatMap((section) => section.items);
  expect(items).toContainEqual(expect.objectContaining({ href: "/admin/calendar" }));
  expect(adminNavSections("en", false, false, false).flatMap((section) => section.items)).not.toContainEqual(
    expect.objectContaining({ href: "/admin/calendar" }),
  );
});
