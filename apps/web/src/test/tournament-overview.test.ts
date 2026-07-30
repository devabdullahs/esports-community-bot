import { describe, expect, test } from "vitest";
import { publicTournamentOverview } from "@/lib/tournaments";

const attribution = "© Esports Foundation 2026. All rights reserved.";

describe("public official tournament overview", () => {
  test("projects only explicitly public aggregate facts from legacy stored payloads", () => {
    expect(publicTournamentOverview({
      updatedAt: "2026-07-29 12:00:00",
      payload: {
        attribution,
        facts: [
          { label: "Tournament Format", value: "Double elimination" },
          { label: "Total Number of Teams", value: "24" },
          { label: "Players Arrival Date", value: "2026/07/20" },
          { label: "Camera Setup", value: "Camera 4" },
          { label: "Admin Notes", value: "Internal only" },
          { label: "Player Name", value: "Private Person" },
          { label: "Official Link", value: "https://docs.google.com/private" },
        ],
        sections: [{
          title: "Participants",
          columns: ["Team", "Region", "Contact Email", "Sheet Link"],
          entries: [{
            Team: "Team Falcons",
            Region: "Gulf",
            "Contact Email": "private@example.test",
            "Sheet Link": "https://drive.google.com/private",
          }],
        }],
        workbookId: "must-not-project",
      },
    })).toEqual({
      attribution,
      updatedAt: "2026-07-29 12:00:00",
      facts: [
        { label: "Tournament Format", value: "Double elimination" },
        { label: "Total Number of Teams", value: "24" },
      ],
      sections: [],
    });
  });

  test("fails closed for arbitrary attribution and source-shaped content", () => {
    expect(publicTournamentOverview({
      payload: {
        attribution: "Official private spreadsheet",
        facts: [{ label: "Tournament Format", value: "Double elimination" }],
      },
    })).toBeNull();
    expect(publicTournamentOverview({
      payload: {
        attribution,
        facts: [{ label: "Workbook ID", value: "private" }],
        sections: [],
      },
    })).toBeNull();
  });
});
