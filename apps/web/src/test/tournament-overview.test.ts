import { describe, expect, test } from "vitest";
import { publicTournamentOverview } from "@/lib/tournaments";

const attribution = "© Esports Foundation 2026. All rights reserved.";

describe("public official tournament overview", () => {
  test("projects bounded public facts and table values with the required attribution", () => {
    expect(publicTournamentOverview({
      updatedAt: "2026-07-29 12:00:00",
      payload: {
        attribution,
        facts: [
          { label: "Organizer", value: "Esports Foundation" },
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
      facts: [{ label: "Organizer", value: "Esports Foundation" }],
      sections: [{
        title: "Participants",
        columns: ["Team", "Region"],
        entries: [{ Team: "Team Falcons", Region: "Gulf" }],
      }],
    });
  });

  test("fails closed for arbitrary attribution and source-shaped content", () => {
    expect(publicTournamentOverview({
      payload: {
        attribution: "Official private spreadsheet",
        facts: [{ label: "Organizer", value: "Esports Foundation" }],
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
