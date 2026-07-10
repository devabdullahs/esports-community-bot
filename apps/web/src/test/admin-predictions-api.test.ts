import { beforeEach, describe, expect, test, vi } from "vitest";
import { anonymous, gamesAdmin, superAdmin } from "./access";

vi.mock("@/lib/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin")>();
  return { ...actual, getAdminAccess: vi.fn() };
});

import { getAdminAccess } from "@/lib/admin";
import { GET, POST } from "@/app/api/admin/predictions/route";
import { predictionOperationRequest } from "@/lib/prediction-operation-model";

const mockAccess = vi.mocked(getAdminAccess);
process.env.EWC_DASHBOARD_DEFAULT_GUILD_ID = "900000000000000901";

function request(method: string, body?: unknown, origin = "http://localhost") {
  return new Request("http://localhost/api/admin/predictions", {
    method,
    headers: { "Content-Type": "application/json", Origin: origin, Host: "localhost" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("admin prediction operations API", () => {
  beforeEach(() => mockAccess.mockReset());

  test("is super-admin-only for reads", async () => {
    mockAccess.mockResolvedValue(anonymous());
    expect((await GET(request("GET"))).status).toBe(401);
    mockAccess.mockResolvedValue(gamesAdmin(["valorant"]));
    expect((await GET(request("GET"))).status).toBe(403);
    mockAccess.mockResolvedValue(superAdmin());
    expect((await GET(request("GET"))).status).toBe(200);
  });

  test("rejects cross-origin mutations before authorization", async () => {
    mockAccess.mockClear();
    const response = await POST(request("POST", {}, "https://evil.example"));
    expect(response.status).toBe(403);
    expect(mockAccess).not.toHaveBeenCalled();
  });

  test("rejects malformed or unsupported operation requests", async () => {
    mockAccess.mockResolvedValue(superAdmin());
    expect((await POST(request("POST", { operation: "drop_table", args: {}, idempotencyKey: "x".repeat(20) }))).status).toBe(400);
    expect((await POST(request("POST", { operation: "delete_week", args: { weekKey: "week-1", confirmationWeekKey: "other" }, idempotencyKey: "y".repeat(20) }))).status).toBe(400);
  });

  test("queues a closed, idempotent operation without importing a Discord client", async () => {
    mockAccess.mockResolvedValue(superAdmin());
    const body = { operation: "refresh_leaderboard", args: {}, idempotencyKey: "prediction-operation-api-00001" };
    const first = await POST(request("POST", body));
    expect(first.status).toBe(202);
    const firstBody = await first.json();
    expect(firstBody.operation.status).toBe("queued");
    expect(JSON.stringify(firstBody)).not.toContain("DISCORD_TOKEN");
    const second = await POST(request("POST", body));
    expect(second.status).toBe(200);
    expect((await second.json()).operation.id).toBe(firstBody.operation.id);
  });

  test("confirmation model cannot retarget a selected round", () => {
    expect(predictionOperationRequest("delete_week", "week-8", "week-7")).toEqual({
      operation: "delete_week",
      args: { weekKey: "week-8", confirmationWeekKey: "week-7" },
    });
    expect(() => predictionOperationRequest("reopen_week", null)).toThrow("round");
    expect(predictionOperationRequest("snapshot_week", "week-8", "", "final")).toEqual({
      operation: "snapshot_week",
      args: { weekKey: "week-8", type: "final" },
    });
    expect(predictionOperationRequest("reopen_season", null)).toEqual({ operation: "reopen_season", args: {} });
    expect(predictionOperationRequest("generate_weeks", null)).toEqual({
      operation: "generate_weeks",
      args: { openBeforeHours: 48, lockBeforeHours: 24, scoreDelayHours: 24 },
    });
  });
});
