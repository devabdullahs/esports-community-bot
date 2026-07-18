import { beforeEach, describe, expect, test, vi } from "vitest";

import { anonymous, gamesAdmin, mediaAdmin } from "./access";

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

import { POST } from "@/app/api/admin/graphics/brand/route";
import { getAdminAccess } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import { uploadToR2 } from "@/lib/r2";

const mockAccess = vi.mocked(getAdminAccess);
const mockAudit = vi.mocked(recordAdminAudit);
const mockUpload = vi.mocked(uploadToR2);

function request(file?: File) {
  const form = new FormData();
  if (file) form.set("file", file);
  return new Request("http://localhost/api/admin/graphics/brand", { method: "POST", body: form });
}

function pngFile(type = "image/png") {
  return new File([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
  ], "brand.png", { type });
}

describe("graphics custom branding upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue(mediaAdmin(["alpha"]));
  });

  test("requires authentication", async () => {
    mockAccess.mockResolvedValue(anonymous());
    expect((await POST(request())).status).toBe(401);
  });

  test("does not allow game-only admins to upload media branding", async () => {
    mockAccess.mockResolvedValue(gamesAdmin(["valorant"]));
    expect((await POST(request(pngFile()))).status).toBe(403);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test("rejects files whose content does not match the declared image type", async () => {
    expect((await POST(request(pngFile("image/jpeg")))).status).toBe(400);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test("uploads branding under its dedicated prefix and audits the action", async () => {
    const response = await POST(request(pngFile()));
    expect(response.status).toBe(200);
    const body = await response.json() as { url: string };
    expect(body.url).toMatch(/^https:\/\/assets\.example\.test\/graphics-branding\/.+\.png$/);
    expect(mockUpload).toHaveBeenCalledWith(expect.objectContaining({
      key: expect.stringMatching(/^graphics-branding\/.+\.png$/),
      contentType: "image/png",
    }));
    expect(mockAudit).toHaveBeenCalledWith(
      mediaAdmin(["alpha"]),
      "graphics.brand-upload",
      null,
      { key: expect.stringMatching(/^graphics-branding\/.+\.png$/) },
    );
  });
});
