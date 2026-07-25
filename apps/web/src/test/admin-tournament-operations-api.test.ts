import { beforeEach, describe, expect, test, vi } from "vitest";
import { anonymous, gamesAdmin, superAdmin } from "./access";

vi.mock("@/lib/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin")>();
  return { ...actual, getAdminAccess: vi.fn() };
});

vi.mock("@/lib/audit", () => ({ recordAdminAudit: vi.fn() }));

vi.mock("@bot/db/tournamentOperations.js", () => ({
  enqueueTournamentOperation: vi.fn(),
  getTournamentOperation: vi.fn(),
  retryTournamentOperation: vi.fn(),
  tournamentOperationIdempotencyKey: vi.fn(() => "tournament:test:nonce"),
}));

vi.mock("@bot/db/tournaments.js", () => ({
  getTournamentById: vi.fn(),
  updateTournamentOverrides: vi.fn(),
}));

import {
  enqueueTournamentOperation,
  getTournamentOperation,
  retryTournamentOperation,
} from "@bot/db/tournamentOperations.js";
import {
  getTournamentById,
  updateTournamentOverrides,
} from "@bot/db/tournaments.js";
import { POST } from "@/app/api/admin/tournaments/operations/route";
import { PATCH } from "@/app/api/admin/tournaments/[id]/metadata/route";
import { getAdminAccess } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";

const mockAccess = vi.mocked(getAdminAccess);
const mockEnqueue = vi.mocked(enqueueTournamentOperation);
const mockGetOperation = vi.mocked(getTournamentOperation);
const mockRetry = vi.mocked(retryTournamentOperation);
const mockGetTournament = vi.mocked(getTournamentById);
const mockUpdateOverrides = vi.mocked(updateTournamentOverrides);
const mockAudit = vi.mocked(recordAdminAudit);

const GUILD_ID = "1087350030693838918";
const OPERATION_ID = "00000000-0000-4000-8000-000000000001";

function request(
  path: string,
  method: "POST" | "PATCH",
  body: unknown,
  origin = "http://localhost",
) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Host: "localhost",
      Origin: origin,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function operation(overrides: Record<string, unknown> = {}) {
  return {
    id: OPERATION_ID,
    guildId: GUILD_ID,
    tournamentId: 42,
    operation: "sync_schedule",
    status: "queued",
    ...overrides,
  };
}

describe("admin tournament operations API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DISCORD_GUILD_ID = GUILD_ID;
    mockGetTournament.mockResolvedValue({
      id: 42,
      guild_id: GUILD_ID,
      source: "liquipedia",
      external_id: "Example",
    } as never);
    mockEnqueue.mockResolvedValue({
      operation: operation(),
      created: true,
    } as never);
    mockRetry.mockResolvedValue(true as never);
    mockUpdateOverrides.mockResolvedValue({
      id: 42,
      guild_id: GUILD_ID,
      display_name_override: "EWC Finals",
      game_override: "valorant",
      ewc_override: 1,
    } as never);
  });

  test("rejects anonymous and scoped admins", async () => {
    mockAccess.mockResolvedValue(anonymous());
    expect((await POST(request(
      "/api/admin/tournaments/operations",
      "POST",
      { intent: "sync_schedule", tournamentId: 42, nonce: "request-0001" },
    ))).status).toBe(401);

    mockAccess.mockResolvedValue(gamesAdmin(["valorant"]));
    expect((await POST(request(
      "/api/admin/tournaments/operations",
      "POST",
      { intent: "sync_schedule", tournamentId: 42, nonce: "request-0002" },
    ))).status).toBe(403);
  });

  test("rejects cross-origin requests before authorization", async () => {
    const response = await POST(request(
      "/api/admin/tournaments/operations",
      "POST",
      { intent: "sync_schedule", tournamentId: 42, nonce: "request-0003" },
      "https://attacker.example",
    ));
    expect(response.status).toBe(403);
    expect(mockAccess).not.toHaveBeenCalled();
  });

  test("rejects oversized and malformed operation bodies", async () => {
    mockAccess.mockResolvedValue(superAdmin());
    const oversized = request(
      "/api/admin/tournaments/operations",
      "POST",
      JSON.stringify({ intent: "sync_schedule", padding: "x".repeat(17 * 1024) }),
    );
    expect((await POST(oversized)).status).toBe(413);

    expect((await POST(request(
      "/api/admin/tournaments/operations",
      "POST",
      { intent: "drop_database", nonce: "request-0004" },
    ))).status).toBe(400);
    expect((await POST(request(
      "/api/admin/tournaments/operations",
      "POST",
      {
        intent: "sync_schedule",
        tournamentId: 42,
        nonce: "request-0005",
        unexpected: true,
      },
    ))).status).toBe(400);
  });

  test("does not operate on a tournament from another guild", async () => {
    mockAccess.mockResolvedValue(superAdmin());
    mockGetTournament.mockResolvedValue({ id: 42, guild_id: "999999999999999999" } as never);
    const response = await POST(request(
      "/api/admin/tournaments/operations",
      "POST",
      { intent: "archive", tournamentId: 42, nonce: "request-0006" },
    ));
    expect(response.status).toBe(404);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  test("queues a durable operation and records its actor", async () => {
    mockAccess.mockResolvedValue(superAdmin());
    const response = await POST(request(
      "/api/admin/tournaments/operations",
      "POST",
      { intent: "sync_standings", tournamentId: 42, nonce: "request-0007" },
    ));
    expect(response.status).toBe(202);
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      guildId: GUILD_ID,
      tournamentId: 42,
      operation: "sync_standings",
      requestedActorType: "web_admin",
    }));
    expect(mockAudit).toHaveBeenCalledWith(
      expect.anything(),
      "tournament.operation.enqueue",
      OPERATION_ID,
      expect.objectContaining({ tournamentId: 42, operation: "sync_standings" }),
    );
  });

  test("validates sources before queueing activation", async () => {
    mockAccess.mockResolvedValue(superAdmin());
    const invalid = await POST(request(
      "/api/admin/tournaments/operations",
      "POST",
      {
        intent: "validate_and_activate",
        input: "https://example.com/not-supported",
        game: null,
        nonce: "request-0008",
      },
    ));
    expect(invalid.status).toBe(400);
    expect(mockEnqueue).not.toHaveBeenCalled();

    const valid = await POST(request(
      "/api/admin/tournaments/operations",
      "POST",
      {
        intent: "validate_and_activate",
        input: "https://liquipedia.net/valorant/Example_Cup",
        game: "valorant",
        nonce: "request-0009",
      },
    ));
    expect(valid.status).toBe(202);
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      source: "liquipedia",
      sourceId: "valorant/Example_Cup",
      game: "valorant",
    }));
  });

  test("retries only failed operations owned by the configured guild", async () => {
    mockAccess.mockResolvedValue(superAdmin());
    mockGetOperation.mockResolvedValue(operation({ status: "succeeded" }) as never);
    expect((await POST(request(
      "/api/admin/tournaments/operations",
      "POST",
      { intent: "retry_operation", operationId: OPERATION_ID },
    ))).status).toBe(409);

    mockGetOperation.mockResolvedValue(operation({ status: "failed" }) as never);
    const response = await POST(request(
      "/api/admin/tournaments/operations",
      "POST",
      { intent: "retry_operation", operationId: OPERATION_ID },
    ));
    expect(response.status).toBe(200);
    expect(mockRetry).toHaveBeenCalledWith(OPERATION_ID);
    expect(mockAudit).toHaveBeenCalledWith(
      expect.anything(),
      "tournament.operation.retry",
      OPERATION_ID,
      expect.anything(),
    );
  });
});

describe("admin tournament metadata API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DISCORD_GUILD_ID = GUILD_ID;
    mockGetTournament.mockResolvedValue({ id: 42, guild_id: GUILD_ID } as never);
    mockUpdateOverrides.mockResolvedValue({ id: 42, guild_id: GUILD_ID } as never);
  });

  test("rejects unauthorized, cross-origin, and foreign-guild updates", async () => {
    mockAccess.mockResolvedValue(anonymous());
    expect((await PATCH(
      request("/api/admin/tournaments/42/metadata", "PATCH", {
        displayName: null,
        game: null,
        ewc: null,
      }),
      { params: Promise.resolve({ id: "42" }) },
    )).status).toBe(401);

    mockAccess.mockClear();
    expect((await PATCH(
      request(
        "/api/admin/tournaments/42/metadata",
        "PATCH",
        { displayName: null, game: null, ewc: null },
        "https://attacker.example",
      ),
      { params: Promise.resolve({ id: "42" }) },
    )).status).toBe(403);
    expect(mockAccess).not.toHaveBeenCalled();

    mockAccess.mockResolvedValue(superAdmin());
    mockGetTournament.mockResolvedValue({ id: 42, guild_id: "999999999999999999" } as never);
    expect((await PATCH(
      request("/api/admin/tournaments/42/metadata", "PATCH", {
        displayName: null,
        game: null,
        ewc: null,
      }),
      { params: Promise.resolve({ id: "42" }) },
    )).status).toBe(404);
  });

  test("validates exact metadata shape and supported games", async () => {
    mockAccess.mockResolvedValue(superAdmin());
    expect((await PATCH(
      request("/api/admin/tournaments/42/metadata", "PATCH", {
        displayName: "Example",
        game: "not-a-game",
        ewc: false,
      }),
      { params: Promise.resolve({ id: "42" }) },
    )).status).toBe(400);
    expect((await PATCH(
      request("/api/admin/tournaments/42/metadata", "PATCH", {
        displayName: null,
        game: null,
        ewc: null,
        extra: true,
      }),
      { params: Promise.resolve({ id: "42" }) },
    )).status).toBe(400);
  });

  test("stores reversible metadata overrides and audits the change", async () => {
    mockAccess.mockResolvedValue(superAdmin());
    const response = await PATCH(
      request("/api/admin/tournaments/42/metadata", "PATCH", {
        displayName: "EWC Finals",
        game: "valorant",
        ewc: true,
      }),
      { params: Promise.resolve({ id: "42" }) },
    );
    expect(response.status).toBe(200);
    expect(mockUpdateOverrides).toHaveBeenCalledWith(42, GUILD_ID, {
      displayName: "EWC Finals",
      game: "valorant",
      ewc: true,
    });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.anything(),
      "tournament.metadata.update",
      "42",
      { displayName: "EWC Finals", game: "valorant", ewc: true },
    );
  });
});
