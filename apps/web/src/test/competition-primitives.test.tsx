import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { FixtureRow } from "@/components/tournaments/competition-primitives";

describe("competition fixture time rendering", () => {
  test("converts stored Unix seconds to the LocalDateTime millisecond contract", () => {
    const scheduledAt = Math.floor(Date.parse("2026-08-02T10:00:00.000Z") / 1000);
    const html = renderToStaticMarkup(
      <FixtureRow
        locale="en"
        match={{
          id: 1,
          name: "ZETA DIVISION vs T1",
          team_a: "ZETA DIVISION",
          team_b: "T1",
          logo_a: null,
          logo_b: null,
          score_a: null,
          score_b: null,
          status: "scheduled",
          scheduled_at: scheduledAt,
        }}
        label="Next match"
      />,
    );

    expect(html).toContain('dateTime="2026-08-02T10:00:00.000Z"');
    expect(html).not.toContain('dateTime="1970-01-21');
  });
});
