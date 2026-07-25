import { beforeEach, describe, expect, test, vi } from "vitest";
import { anonymous, gamesAdmin, nonAdmin } from "./access";
import {
  API_AUTHORIZATION_POLICY,
  type AuthorizationPolicyEntry,
  type HttpMethod,
} from "./api-authorization-policy";

vi.mock("@/lib/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin")>();
  return { ...actual, getAdminAccess: vi.fn() };
});

vi.mock("@/lib/community", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/community")>();
  return {
    ...actual,
    getCommunityMember: vi.fn(),
    requireVerifiedMember: vi.fn(),
  };
});

vi.mock("@/lib/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session")>();
  return { ...actual, getOptionalSession: vi.fn() };
});

vi.mock("@/lib/follows", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/follows")>();
  return { ...actual, getViewerDiscordId: vi.fn() };
});

import { getAdminAccess } from "@/lib/admin";
import { getCommunityMember, requireVerifiedMember } from "@/lib/community";
import { getViewerDiscordId } from "@/lib/follows";
import { getOptionalSession } from "@/lib/session";

type RouteContext = {
  params: Promise<Record<string, string>>;
};

type RouteHandler = (
  request: Request,
  context: RouteContext,
) => Response | Promise<Response>;

type RouteModule = Partial<Record<HttpMethod, RouteHandler>>;

const routeModules = import.meta.glob("../app/api/**/route.ts") as Record<
  string,
  () => Promise<RouteModule>
>;

const mockAdminAccess = vi.mocked(getAdminAccess);
const mockCommunityMember = vi.mocked(getCommunityMember);
const mockRequireVerifiedMember = vi.mocked(requireVerifiedMember);
const mockViewerDiscordId = vi.mocked(getViewerDiscordId);
const mockOptionalSession = vi.mocked(getOptionalSession);

const PARAM_VALUES: Record<string, string> = {
  discordId: "222222222222222222",
  guildId: "1087350030693838918",
  id: "1",
  leagueId: "00000000-0000-4000-8000-000000000001",
  postId: "1",
  season: "2026",
  slug: "valorant",
  token: "public-avatar-token",
};

const PROTECTED_POLICIES = new Set([
  "session-self",
  "verified-member",
  "allowed-admin",
  "game-media-admin",
  "media-admin",
  "super-admin",
  "internal-capability",
  "admin-mcp",
]);
const ADMIN_POLICIES = new Set([
  "allowed-admin",
  "game-media-admin",
  "media-admin",
  "super-admin",
]);

function routeModuleKey(route: string) {
  return `../app/api/${route}/route.ts`;
}

function routeParams(route: string): Record<string, string> {
  return Object.fromEntries(
    [...route.matchAll(/\[([^\]]+)\]/g)].map((match) => {
      const name = match[1].replace(/^\.{3}/, "");
      return [name, PARAM_VALUES[name] ?? "test"];
    }),
  );
}

function concretePath(route: string, params: Record<string, string>) {
  return route.replace(/\[([^\]]+)\]/g, (_segment, rawName: string) => {
    const name = rawName.replace(/^\.{3}/, "");
    return encodeURIComponent(params[name] ?? "test");
  });
}

function requestFor(
  entry: AuthorizationPolicyEntry,
  origin: "same" | "cross" | "missing" = "same",
  extraHeaders: Record<string, string> = {},
) {
  const params = routeParams(entry.route);
  const headers = new Headers({ Host: "localhost", ...extraHeaders });
  if (origin === "same") headers.set("Origin", "http://localhost");
  if (origin === "cross") headers.set("Origin", "https://attacker.example");

  const init: RequestInit = { method: entry.method, headers };
  if (!["GET", "HEAD"].includes(entry.method)) {
    headers.set("Content-Type", "application/json");
    init.body = entry.policy === "admin-mcp"
      ? JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
      : "{}";
  }

  return {
    request: new Request(
      `http://localhost/api/${concretePath(entry.route, params)}`,
      init,
    ),
    context: { params: Promise.resolve(params) },
  };
}

async function invoke(
  entry: AuthorizationPolicyEntry,
  origin: "same" | "cross" | "missing" = "same",
  extraHeaders: Record<string, string> = {},
) {
  const importer = routeModules[routeModuleKey(entry.route)];
  if (!importer) throw new Error(`Missing route module for ${entry.route}`);
  const route = await importer();
  const handler = route[entry.method];
  if (!handler) throw new Error(`Missing ${entry.method} handler for ${entry.route}`);
  const { request, context } = requestFor(entry, origin, extraHeaders);
  return handler(request, context);
}

function expectNoIdentityLookup() {
  expect(mockAdminAccess).not.toHaveBeenCalled();
  expect(mockCommunityMember).not.toHaveBeenCalled();
  expect(mockRequireVerifiedMember).not.toHaveBeenCalled();
  expect(mockViewerDiscordId).not.toHaveBeenCalled();
  expect(mockOptionalSession).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EWC_MCP_ENABLED = "true";
  process.env.EWC_DASHBOARD_INTERNAL_PROFILE_SYNC_SECRET =
    "profile-sync-test-secret-that-is-long-enough";
  process.env.EWC_DASHBOARD_INTERNAL_NEWS_REVALIDATE_SECRET =
    "news-revalidate-test-secret-that-is-long-enough";
  mockAdminAccess.mockResolvedValue(anonymous());
  mockCommunityMember.mockResolvedValue({ session: null, member: null });
  mockRequireVerifiedMember.mockResolvedValue({
    response: Response.json(
      { error: "Sign in to continue.", code: "unauthenticated" },
      { status: 401 },
    ),
  });
  mockViewerDiscordId.mockResolvedValue(null);
  mockOptionalSession.mockResolvedValue(null);
});

const protectedEntries = API_AUTHORIZATION_POLICY.filter((entry) =>
  PROTECTED_POLICIES.has(entry.policy),
);

describe("API protected-route denial matrix", () => {
  for (const entry of protectedEntries) {
    test(`${entry.method} /api/${entry.route} denies its anonymous fixture`, async () => {
      const response = await invoke(entry);
      expect(response.status).toBe(401);
    });
  }
});

describe("API mutation CSRF matrix", () => {
  for (const entry of API_AUTHORIZATION_POLICY.filter((item) => item.csrf)) {
    test(`${entry.method} /api/${entry.route} rejects a cross-origin request before identity lookup`, async () => {
      const response = await invoke(entry, "cross");
      expect(response.status).toBe(403);
      expectNoIdentityLookup();
    });

    test(`${entry.method} /api/${entry.route} rejects a missing Origin before identity lookup`, async () => {
      const response = await invoke(entry, "missing");
      expect(response.status).toBe(403);
      expectNoIdentityLookup();
    });
  }
});

describe("API admin-tier matrix", () => {
  for (const entry of API_AUTHORIZATION_POLICY.filter((item) =>
    ADMIN_POLICIES.has(item.policy),
  )) {
    test(`${entry.method} /api/${entry.route} rejects an authenticated non-admin`, async () => {
      mockAdminAccess.mockResolvedValue(nonAdmin());
      const response = await invoke(entry);
      expect(response.status).toBe(403);
    });
  }

  for (const entry of API_AUTHORIZATION_POLICY.filter(
    (item) => item.tierFixture === "scoped-admin-denied",
  )) {
    test(`${entry.method} /api/${entry.route} rejects a scoped admin`, async () => {
      mockAdminAccess.mockResolvedValue(gamesAdmin(["valorant"]));
      const response = await invoke(entry);
      expect(response.status).toBe(403);
    });
  }

  for (const entry of API_AUTHORIZATION_POLICY.filter(
    (item) => item.tierFixture === "scoped-admin-allowed",
  )) {
    test(`${entry.method} /api/${entry.route} admits a scoped admin past the tier gate`, async () => {
      mockAdminAccess.mockResolvedValue(gamesAdmin(["valorant"]));
      const response = await invoke(entry);
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    });
  }
});

describe("API internal-capability credential matrix", () => {
  for (const entry of API_AUTHORIZATION_POLICY.filter(
    (item) => item.policy === "internal-capability",
  )) {
    test(`${entry.method} /api/${entry.route} rejects a wrong capability secret`, async () => {
      const response = await invoke(entry, "same", {
        "x-ewc-internal-secret": "wrong-internal-secret-that-is-long-enough",
      });
      expect(response.status).toBe(401);
    });
  }
});

describe("API admin MCP boundary matrix", () => {
  const entry = API_AUTHORIZATION_POLICY.find(
    (item) => item.route === "mcp" && item.method === "POST",
  )!;

  test("rejects an invalid bearer key", async () => {
    const response = await invoke(entry, "same", {
      Authorization: "Bearer ec_mcp_live_invalid",
    });
    expect(response.status).toBe(401);
  });

  test("rejects a disallowed browser origin before bearer validation", async () => {
    const response = await invoke(entry, "cross", {
      Authorization: "Bearer ec_mcp_live_invalid",
    });
    expect(response.status).toBe(403);
  });
});
