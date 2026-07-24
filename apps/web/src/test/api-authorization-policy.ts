export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

export type ApiAuthorizationPolicy =
  | "public"
  | "framework-auth"
  | "session-self"
  | "verified-member"
  | "allowed-admin"
  | "game-media-admin"
  | "media-admin"
  | "super-admin"
  | "internal-capability"
  | "admin-mcp"
  | "public-mcp";

export type NegativeFixture =
  | "admin-anonymous"
  | "session-anonymous"
  | "member-anonymous"
  | "internal-capability"
  | "admin-mcp-invalid-key";

export type AuthorizationPolicyEntry = {
  route: string;
  method: HttpMethod;
  policy: ApiAuthorizationPolicy;
  relationship: string;
  negativeFixture?: NegativeFixture;
  csrf?: boolean;
  tierFixture?: "scoped-admin-denied" | "scoped-admin-allowed";
};

type SharedPolicy = Omit<AuthorizationPolicyEntry, "route" | "method">;
type RouteMethods = readonly [route: string, methods: readonly HttpMethod[]];

function entries(routes: readonly RouteMethods[], policy: SharedPolicy): AuthorizationPolicyEntry[] {
  return routes.flatMap(([route, methods]) =>
    methods.map((method) => ({ route, method, ...policy })),
  );
}

function mixed(
  route: string,
  methods: Partial<Record<HttpMethod, SharedPolicy>>,
): AuthorizationPolicyEntry[] {
  return Object.entries(methods).map(([method, policy]) => ({
    route,
    method: method as HttpMethod,
    ...policy!,
  }));
}

const PUBLIC: SharedPolicy = {
  policy: "public",
  relationship: "No authenticated identity or privileged data is required.",
};
const MEMBER: SharedPolicy = {
  policy: "verified-member",
  relationship: "The Discord member identity is derived from the verified server session.",
  negativeFixture: "member-anonymous",
};
const SESSION: SharedPolicy = {
  policy: "session-self",
  relationship: "The target account is derived from the authenticated Better Auth session.",
  negativeFixture: "session-anonymous",
};
const ALLOWED_ADMIN: SharedPolicy = {
  policy: "allowed-admin",
  relationship: "The operation is an intentional global action available to any configured admin.",
  negativeFixture: "admin-anonymous",
  tierFixture: "scoped-admin-allowed",
};
const SCOPED_ADMIN: SharedPolicy = {
  policy: "game-media-admin",
  relationship: "The stored or submitted parent game/media slug must be in the admin assignment.",
  negativeFixture: "admin-anonymous",
};
const SUPER_ADMIN: SharedPolicy = {
  policy: "super-admin",
  relationship: "The operation is intentionally restricted to the configured super-admin roster.",
  negativeFixture: "admin-anonymous",
  tierFixture: "scoped-admin-denied",
};

const POLICY_ENTRIES: readonly AuthorizationPolicyEntry[] = [
  ...entries([
    ["analytics/event", ["POST"]],
    ["co-streams", ["GET"]],
    ["compare/search", ["GET"]],
    ["deployment-version", ["GET"]],
    ["ewc/[guildId]/[season]/leaderboard", ["GET"]],
    ["ewc/public-avatar/[token]", ["GET"]],
    ["live", ["GET"]],
    ["logo", ["GET"]],
    ["matches/[id]/comments", ["GET"]],
    ["news/[postId]/comments", ["GET"]],
    ["search", ["GET"]],
    ["tournaments", ["GET"]],
    ["tournaments/[id]/matches", ["GET"]],
  ], PUBLIC),
  ...entries([
    ["auth/[...all]", ["GET", "POST"]],
  ], {
    policy: "framework-auth",
    relationship: "Better Auth owns authentication and callback semantics for this handler.",
  }),
  ...entries([
    ["partners/inquiries", ["POST"]],
  ], {
    ...PUBLIC,
    relationship: "Public inquiry creation is same-origin and rate-limited.",
    csrf: true,
  }),
  ...entries([
    ["public-mcp", ["POST"]],
  ], {
    policy: "public-mcp",
    relationship: "The endpoint exposes the read-only public MCP tool manifest.",
  }),
  ...entries([
    ["mcp", ["POST"]],
  ], {
    policy: "admin-mcp",
    relationship: "A valid MCP key is intersected with its owner's current admin roster and scopes.",
    negativeFixture: "admin-mcp-invalid-key",
  }),
  ...entries([
    ["internal/ewc-profile/sync", ["POST"]],
  ], {
    policy: "internal-capability",
    relationship: "The profile-sync capability is pinned to the configured Discord guild.",
    negativeFixture: "internal-capability",
  }),
  ...entries([
    ["internal/news/revalidate", ["POST"]],
  ], {
    policy: "internal-capability",
    relationship: "The news-revalidate capability authorizes only cache invalidation.",
    negativeFixture: "internal-capability",
  }),

  ...entries([
    ["comments/[id]", ["PATCH", "DELETE"]],
    ["comments/[id]/like", ["PUT", "DELETE"]],
    ["comments/[id]/report", ["POST"]],
    ["matches/[id]/comments", ["POST"]],
    ["me/ewc/picks/season", ["POST"]],
    ["me/ewc/picks/weekly", ["POST"]],
    ["me/ewc/public-identity", ["POST", "DELETE"]],
    ["me/match-reminders", ["POST", "DELETE"]],
    ["me/prediction-leagues", ["GET", "POST"]],
    ["me/prediction-leagues/[leagueId]", ["GET", "DELETE"]],
    ["me/prediction-leagues/[leagueId]/leave", ["POST"]],
    ["me/prediction-leagues/join", ["POST"]],
    ["me/today", ["GET"]],
    ["mvp/vote", ["POST"]],
    ["news/[postId]/comments", ["POST"]],
    ["news/[postId]/like", ["PUT", "DELETE"]],
  ], MEMBER),
  ...entries([
    ["comments/[id]", ["PATCH", "DELETE"]],
    ["comments/[id]/like", ["PUT", "DELETE"]],
    ["comments/[id]/report", ["POST"]],
    ["matches/[id]/comments", ["POST"]],
    ["me/ewc/picks/season", ["POST"]],
    ["me/ewc/picks/weekly", ["POST"]],
    ["me/ewc/public-identity", ["POST", "DELETE"]],
    ["me/match-reminders", ["POST", "DELETE"]],
    ["me/prediction-leagues", ["POST"]],
    ["me/prediction-leagues/[leagueId]", ["DELETE"]],
    ["me/prediction-leagues/[leagueId]/leave", ["POST"]],
    ["me/prediction-leagues/join", ["POST"]],
    ["mvp/vote", ["POST"]],
    ["news/[postId]/comments", ["POST"]],
    ["news/[postId]/like", ["PUT", "DELETE"]],
  ], {
    ...MEMBER,
    csrf: true,
  }),
  ...entries([
    ["me/calendar", ["GET"]],
    ["me/calendar/ics", ["GET"]],
    ["me/ewc", ["GET", "POST"]],
    ["me/ewc/sync", ["POST"]],
    ["me/ewc/unlink", ["POST"]],
    ["me/follows", ["GET", "POST", "DELETE", "PATCH"]],
    ["me/notification-prefs", ["GET", "PATCH"]],
    ["me/notifications", ["GET", "PATCH"]],
    ["me/share-card", ["GET"]],
  ], SESSION),
  ...entries([
    ["me/ewc", ["POST"]],
    ["me/ewc/sync", ["POST"]],
    ["me/ewc/unlink", ["POST"]],
    ["me/follows", ["POST", "DELETE", "PATCH"]],
    ["me/notification-prefs", ["PATCH"]],
    ["me/notifications", ["PATCH"]],
  ], {
    ...SESSION,
    csrf: true,
  }),

  ...entries([
    ["admin/comments", ["GET"]],
    ["admin/comments/[id]/moderate", ["POST"]],
    ["admin/graphics", ["POST"]],
    ["admin/graphics/asset", ["POST"]],
    ["admin/news/upload", ["POST"]],
  ], ALLOWED_ADMIN),
  ...entries([
    ["admin/comments/[id]/moderate", ["POST"]],
    ["admin/graphics", ["POST"]],
    ["admin/graphics/asset", ["POST"]],
    ["admin/news/upload", ["POST"]],
  ], {
    ...ALLOWED_ADMIN,
    csrf: true,
  }),
  ...entries([
    ["admin/analytics/posts", ["GET"]],
    ["admin/authors", ["GET"]],
    ["admin/games", ["GET"]],
    ["admin/games/[slug]", ["PATCH"]],
    ["admin/media", ["GET"]],
    ["admin/media/[slug]", ["PATCH"]],
    ["admin/news", ["GET", "POST"]],
    ["admin/news/[id]", ["PATCH", "DELETE"]],
    ["admin/news/[id]/status", ["POST"]],
  ], SCOPED_ADMIN),
  ...entries([
    ["admin/games/[slug]", ["PATCH"]],
    ["admin/media/[slug]", ["PATCH"]],
    ["admin/news", ["POST"]],
    ["admin/news/[id]", ["PATCH", "DELETE"]],
    ["admin/news/[id]/status", ["POST"]],
  ], {
    ...SCOPED_ADMIN,
    csrf: true,
  }),
  ...entries([
    ["admin/graphics/brand", ["POST"]],
  ], {
    policy: "media-admin",
    relationship: "Custom branding requires at least one current media-channel assignment.",
    negativeFixture: "admin-anonymous",
    csrf: true,
  }),
  ...entries([
    ["admin/mcp-keys", ["GET", "POST"]],
    ["admin/mcp-keys/[id]", ["DELETE"]],
  ], {
    policy: "allowed-admin",
    relationship: "Non-super admins can list/create only their own keys and revoke only a key they own.",
    negativeFixture: "admin-anonymous",
  }),
  ...entries([
    ["admin/mcp-keys", ["POST"]],
    ["admin/mcp-keys/[id]", ["DELETE"]],
  ], {
    policy: "allowed-admin",
    relationship: "Non-super admins can list/create only their own keys and revoke only a key they own.",
    negativeFixture: "admin-anonymous",
    csrf: true,
  }),
  ...entries([
    ["admin/comments/bulk", ["POST"]],
    ["admin/comments/keyword-rules", ["GET", "POST"]],
    ["admin/comments/keyword-rules/[id]", ["PATCH"]],
    ["admin/games", ["POST"]],
    ["admin/games/[slug]", ["DELETE"]],
    ["admin/games/reorder", ["POST"]],
    ["admin/media", ["POST"]],
    ["admin/media/[slug]", ["DELETE"]],
    ["admin/media/reorder", ["POST"]],
    ["admin/partners", ["GET", "POST"]],
    ["admin/partners/[id]", ["PATCH", "DELETE"]],
    ["admin/partners/campaigns", ["GET", "POST"]],
    ["admin/partners/campaigns/[id]", ["PATCH", "DELETE"]],
    ["admin/partners/inquiries/[id]", ["PATCH"]],
    ["admin/predictions", ["GET", "POST"]],
    ["admin/predictions/[id]/retry", ["POST"]],
    ["admin/streams", ["GET", "POST"]],
    ["admin/streams/[id]", ["PATCH", "DELETE"]],
    ["admin/team", ["GET", "POST"]],
    ["admin/team/[discordId]", ["PATCH", "DELETE"]],
    ["admin/users/[discordId]/block", ["POST", "DELETE"]],
  ], SUPER_ADMIN),
  ...entries([
    ["admin/comments/bulk", ["POST"]],
    ["admin/comments/keyword-rules", ["POST"]],
    ["admin/comments/keyword-rules/[id]", ["PATCH"]],
    ["admin/games", ["POST"]],
    ["admin/games/[slug]", ["DELETE"]],
    ["admin/games/reorder", ["POST"]],
    ["admin/media", ["POST"]],
    ["admin/media/[slug]", ["DELETE"]],
    ["admin/media/reorder", ["POST"]],
    ["admin/partners", ["POST"]],
    ["admin/partners/[id]", ["PATCH", "DELETE"]],
    ["admin/partners/campaigns", ["POST"]],
    ["admin/partners/campaigns/[id]", ["PATCH", "DELETE"]],
    ["admin/partners/inquiries/[id]", ["PATCH"]],
    ["admin/predictions", ["POST"]],
    ["admin/predictions/[id]/retry", ["POST"]],
    ["admin/streams", ["POST"]],
    ["admin/streams/[id]", ["PATCH", "DELETE"]],
    ["admin/team", ["POST"]],
    ["admin/team/[discordId]", ["PATCH", "DELETE"]],
    ["admin/users/[discordId]/block", ["POST", "DELETE"]],
  ], {
    ...SUPER_ADMIN,
    csrf: true,
  }),

  // Explicit mixed-method object policies live here so reviewers can find
  // ownership boundaries without reading route implementation details.
  ...mixed("me/prediction-leagues/[leagueId]", {
    GET: {
      ...MEMBER,
      relationship: "The authenticated member must belong to the requested league.",
    },
    DELETE: {
      ...MEMBER,
      relationship: "The authenticated member must own the requested league.",
      csrf: true,
    },
  }),
] as const;

export function authorizationPolicyKey(route: string, method: HttpMethod): string {
  return `${route}#${method}`;
}

const policyByKey = new Map<string, AuthorizationPolicyEntry>();
for (const entry of POLICY_ENTRIES) {
  const key = authorizationPolicyKey(entry.route, entry.method);
  const previous = policyByKey.get(key);
  policyByKey.set(key, previous ? { ...previous, ...entry } : entry);
}

export const API_AUTHORIZATION_POLICY = [...policyByKey.values()] as const;
