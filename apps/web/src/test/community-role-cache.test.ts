import { describe, expect, test } from "vitest";
import {
  createRoleVerifier,
  ROLE_CACHE_CAPACITY,
  type RoleVerificationEvent,
} from "@/lib/discord-role-verification";

// Synthetic throughout. No test may reach Discord, and no real token, header, role, or member
// ID may appear here or in anything the verifier emits.
const SYNTHETIC_TOKEN = "SYNTHETIC-BOT-TOKEN-NEVER-REAL";
const SYNTHETIC_GUILD = "900000000000000001";
const SYNTHETIC_USER = "900000000000000002";
const VERIFIED_ROLE = "900000000000000003";

function harness(responses: Array<Response | Error>) {
  let clock = 1_000_000;
  const events: Array<[RoleVerificationEvent, string]> = [];
  let calls = 0;

  const verifier = createRoleVerifier({
    guildId: SYNTHETIC_GUILD,
    token: SYNTHETIC_TOKEN,
    now: () => clock,
    fetchImpl: (async () => {
      const next = responses[Math.min(calls, responses.length - 1)];
      calls += 1;
      if (next instanceof Error) throw next;
      return next.clone();
    }) as unknown as typeof fetch,
    onEvent: (event, statusClass) => events.push([event, statusClass]),
  });

  return {
    verifier,
    events,
    calls: () => calls,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

function memberResponse(roles: string[]) {
  return new Response(JSON.stringify({ roles }), { status: 200 });
}

describe("Discord role verification state machine", () => {
  test("a fresh cache entry makes no Discord call", async () => {
    const h = harness([memberResponse([VERIFIED_ROLE])]);

    await h.verifier.verify(SYNTHETIC_USER);
    h.advance(59_000);
    const second = await h.verifier.verify(SYNTHETIC_USER);

    expect(h.calls()).toBe(1);
    expect(second).toMatchObject({ status: "verified", source: "cache" });
  });

  test("a transient failure inside grace serves old roles and does NOT move the timestamp", async () => {
    const h = harness([memberResponse([VERIFIED_ROLE]), new Error("network down")]);

    const fresh = await h.verifier.verify(SYNTHETIC_USER);
    const verifiedAt = fresh.status === "verified" ? fresh.verifiedAt : 0;

    h.advance(90_000); // past the fresh TTL, inside the 120s maximum age
    const grace = await h.verifier.verify(SYNTHETIC_USER);

    expect(grace).toMatchObject({ status: "verified", source: "grace", verifiedAt });
    // Repeated failures must not extend authorization: the age keeps growing from the last
    // SUCCESS, so grace expires on schedule rather than being renewed each time.
    h.advance(31_000);
    expect(await h.verifier.verify(SYNTHETIC_USER)).toEqual({ status: "unavailable" });
    expect(h.events.map(([event]) => event)).toContain("discord-role-grace");
    expect(h.events.map(([event]) => event)).toContain("discord-role-grace-expired");
  });

  test("the same failure past the maximum stale age is unavailable", async () => {
    const h = harness([memberResponse([VERIFIED_ROLE]), new Error("network down")]);

    await h.verifier.verify(SYNTHETIC_USER);
    h.advance(120_001);

    expect(await h.verifier.verify(SYNTHETIC_USER)).toEqual({ status: "unavailable" });
  });

  test("404 is a definitive non-member and never uses grace", async () => {
    const h = harness([memberResponse([VERIFIED_ROLE]), new Response("", { status: 404 })]);

    await h.verifier.verify(SYNTHETIC_USER);
    h.advance(61_000);

    expect(await h.verifier.verify(SYNTHETIC_USER)).toMatchObject({ status: "not-member" });
  });

  test.each([401, 403])("%i revokes cached authorization immediately", async (status) => {
    const h = harness([memberResponse([VERIFIED_ROLE]), new Response("", { status })]);

    await h.verifier.verify(SYNTHETIC_USER);
    h.advance(61_000);

    expect(await h.verifier.verify(SYNTHETIC_USER)).toEqual({ status: "unavailable" });
    // The entry is gone, so a later failure cannot resurrect the old allow through grace.
    h.advance(1_000);
    expect(await h.verifier.verify(SYNTHETIC_USER)).toEqual({ status: "unavailable" });
  });

  test("a successful refresh replaces both roles and timestamp", async () => {
    const h = harness([memberResponse([VERIFIED_ROLE]), memberResponse([])]);

    const first = await h.verifier.verify(SYNTHETIC_USER);
    h.advance(61_000);
    const second = await h.verifier.verify(SYNTHETIC_USER);

    expect(first).toMatchObject({ status: "verified", roles: [VERIFIED_ROLE], source: "fresh" });
    expect(second).toMatchObject({ status: "verified", roles: [], source: "fresh" });
    if (first.status === "verified" && second.status === "verified") {
      expect(second.verifiedAt).toBeGreaterThan(first.verifiedAt);
    }
  });

  test("a malformed Discord response fails closed", async () => {
    const h = harness([new Response("{\"roles\":\"not-an-array\"}", { status: 200 })]);

    expect(await h.verifier.verify(SYNTHETIC_USER)).toEqual({ status: "unavailable" });
  });

  test("the cache is hard-bounded and evicts deterministically", async () => {
    const h = harness([memberResponse([VERIFIED_ROLE])]);

    for (let i = 0; i < ROLE_CACHE_CAPACITY + 25; i += 1) {
      await h.verifier.verify(`90000000000000${String(i).padStart(4, "0")}`);
      h.advance(1);
    }

    expect(h.verifier.size()).toBeLessThanOrEqual(ROLE_CACHE_CAPACITY);
  });

  test("telemetry carries only an event and a status class", async () => {
    const h = harness([memberResponse([VERIFIED_ROLE]), new Response("", { status: 503 })]);

    await h.verifier.verify(SYNTHETIC_USER);
    h.advance(61_000);
    await h.verifier.verify(SYNTHETIC_USER);

    const serialized = JSON.stringify(h.events);
    expect(serialized).toContain("discord-role-grace");
    expect(serialized).not.toContain(SYNTHETIC_TOKEN);
    expect(serialized).not.toContain(SYNTHETIC_USER);
    expect(serialized).not.toContain(VERIFIED_ROLE);
  });
});
