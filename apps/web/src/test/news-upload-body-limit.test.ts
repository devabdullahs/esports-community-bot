import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  origin: vi.fn(),
  rateLimit: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({
  getAdminAccess: mocks.access,
}));
vi.mock("@/lib/community", () => ({
  sameOriginOr403: mocks.origin,
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimitOr429: mocks.rateLimit,
}));
vi.mock("@/lib/r2", () => ({
  isR2Configured: () => true,
  uploadToR2: mocks.upload,
}));
vi.mock("@/lib/audit", () => ({
  recordAdminAudit: vi.fn(),
}));

import { POST } from "@/app/api/admin/news/upload/route";

const access = {
  session: { user: { id: "auth-user" } },
  allowed: true,
  isSuper: true,
  discordUserId: "200000000000000001",
  displayName: "Admin",
  gameSlugs: [],
  mediaSlugs: [],
};

function uploadRequest(contentLength: number, body = "--x--\r\n") {
  return new Request("http://localhost/api/admin/news/upload", {
    method: "POST",
    headers: {
      "Content-Type": "multipart/form-data; boundary=x",
      "Content-Length": String(contentLength),
      Origin: "http://localhost",
      Host: "localhost",
    },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.origin.mockReturnValue(null);
  mocks.access.mockResolvedValue(access);
  mocks.rateLimit.mockResolvedValue(null);
});

describe("news upload request-body admission", () => {
  test("runs origin and authorization before reading an oversized body", async () => {
    mocks.access.mockResolvedValueOnce({ ...access, session: null, allowed: false });

    const response = await POST(uploadRequest(9 * 1024 * 1024));

    expect(response.status).toBe(401);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  test("returns 413 for an oversized authenticated multipart body", async () => {
    const response = await POST(uploadRequest(9 * 1024 * 1024));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "Request body is too large." });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  test("returns 400 for malformed bounded multipart data", async () => {
    const response = await POST(uploadRequest(7, "invalid"));

    expect(response.status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
