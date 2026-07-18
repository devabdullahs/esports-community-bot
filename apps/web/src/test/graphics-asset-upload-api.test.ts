import { beforeEach, describe, expect, test, vi } from "vitest";

import { anonymous, gamesAdmin } from "./access";

vi.mock("@/lib/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin")>();
  return { ...actual, getAdminAccess: vi.fn() };
});
vi.mock("@/lib/audit", () => ({ recordAdminAudit: vi.fn() }));
vi.mock("@/lib/community", () => ({ sameOriginOr403: vi.fn(() => null) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOr429: vi.fn(async () => null) }));
vi.mock("@/lib/r2", () => ({
  isR2Configured: vi.fn(() => true),
  uploadToR2: vi.fn(async ({ key }: { key: string }) => `https://assets.example.test/${key}`),
}));

import { POST } from "@/app/api/admin/graphics/asset/route";
import { getAdminAccess } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import { uploadToR2 } from "@/lib/r2";

const mockAccess = vi.mocked(getAdminAccess);
const mockAudit = vi.mocked(recordAdminAudit);
const mockUpload = vi.mocked(uploadToR2);

function request(file?: File) {
  const form = new FormData();
  if (file) form.set("file", file);
  return new Request("http://localhost/api/admin/graphics/asset", { method: "POST", body: form });
}

function pngFile(type = "image/png") {
  return new File([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
  ], "team.png", { type });
}

describe("graphics custom asset upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue(gamesAdmin(["valorant"]));
  });

  test("requires an authenticated admin", async () => {
    mockAccess.mockResolvedValue(anonymous());
    expect((await POST(request())).status).toBe(401);
  });

  test("rejects mismatched image content", async () => {
    expect((await POST(request(pngFile("image/jpeg")))).status).toBe(400);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test("allows scoped admins to upload a managed graphics asset", async () => {
    const response = await POST(request(pngFile()));
    expect(response.status).toBe(200);
    const body = await response.json() as { url: string };
    expect(body.url).toMatch(/^https:\/\/assets\.example\.test\/graphics-assets\/.+\.png$/);
    expect(mockUpload).toHaveBeenCalledWith(expect.objectContaining({
      key: expect.stringMatching(/^graphics-assets\/.+\.png$/),
      contentType: "image/png",
    }));
    expect(mockAudit).toHaveBeenCalledWith(
      gamesAdmin(["valorant"]),
      "graphics.asset-upload",
      null,
      { key: expect.stringMatching(/^graphics-assets\/.+\.png$/) },
    );
  });
});
