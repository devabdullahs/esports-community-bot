/**
 * The web auth-DB pool must resolve Postgres TLS via the SAME shared mapping as
 * the bot pool (src/db/client.js), reachable through the @bot alias. This guards
 * against reintroducing a divergent web-only SSL config (see plan 043).
 */
import { describe, expect, test } from "vitest";
import { resolvePgSslConfig } from "@bot/db/client.js";

describe("resolvePgSslConfig (shared, via @bot alias)", () => {
  test("disable -> false (no TLS)", () => {
    expect(resolvePgSslConfig("disable")).toBe(false);
  });
  test("require / no-verify -> encrypt without verifying", () => {
    expect(resolvePgSslConfig("require")).toEqual({ rejectUnauthorized: false });
    expect(resolvePgSslConfig("no-verify")).toEqual({ rejectUnauthorized: false });
  });
  test("verify-ca / verify-full -> verify the cert", () => {
    expect(resolvePgSslConfig("verify-ca")).toEqual({ rejectUnauthorized: true });
    expect(resolvePgSslConfig("verify-full")).toEqual({ rejectUnauthorized: true });
  });
  test("unset / unknown -> undefined", () => {
    expect(resolvePgSslConfig("")).toBeUndefined();
    expect(resolvePgSslConfig(undefined)).toBeUndefined();
    expect(resolvePgSslConfig("something-else")).toBeUndefined();
  });
  test("mode is case-insensitive", () => {
    expect(resolvePgSslConfig("Verify-Full")).toEqual({ rejectUnauthorized: true });
  });
});
