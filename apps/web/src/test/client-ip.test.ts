import { afterEach, describe, expect, test } from "vitest";
import { clientIp } from "@/lib/community";

function req(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/test", { method: "POST", headers });
}

const ORIGINAL_MODE = process.env.EWC_TRUSTED_PROXY;

afterEach(() => {
  if (ORIGINAL_MODE === undefined) delete process.env.EWC_TRUSTED_PROXY;
  else process.env.EWC_TRUSTED_PROXY = ORIGINAL_MODE;
});

describe("clientIp trusted resolver", () => {
  test("accepts and canonicalizes a valid IPv4 header under cloudflare mode", () => {
    expect(clientIp(req({ "cf-connecting-ip": " 203.0.113.9 " }))).toBe("203.0.113.9");
    expect(clientIp(req({ "cf-connecting-ip": "::ffff:203.0.113.9" }))).toBe("203.0.113.9");
  });

  test("buckets IPv6 to its /64 so interface rotation cannot mint keys", () => {
    const a = clientIp(req({ "cf-connecting-ip": "2001:db8:1:2:aaaa:bbbb:cccc:dddd" }));
    const b = clientIp(req({ "cf-connecting-ip": "2001:DB8:1:2::9" }));
    expect(a).toBe("2001:0db8:0001:0002::/64");
    expect(b).toBe(a);
    const other = clientIp(req({ "cf-connecting-ip": "2001:db8:1:3::9" }));
    expect(other).not.toBe(a);
  });

  test("forged or malformed header values collapse into the shared invalid bucket", () => {
    for (const forged of [
      "not-an-ip",
      "203.0.113.999",
      "203.0.113.9; DROP TABLE",
      "veryLongKey".repeat(20),
      "2001:db8::1::2",
      "::ffff:evil",
    ]) {
      expect(clientIp(req({ "cf-connecting-ip": forged }))).toBe("invalid");
    }
  });

  test("x-forwarded-for and x-real-ip are never consulted", () => {
    const value = clientIp(
      req({ "x-forwarded-for": "198.51.100.7", "x-real-ip": "198.51.100.8" }),
    );
    expect(value).toBe("direct");
  });

  test("missing header falls back to the shared direct bucket", () => {
    expect(clientIp(req())).toBe("direct");
  });

  test("EWC_TRUSTED_PROXY=none ignores proxy headers entirely", () => {
    process.env.EWC_TRUSTED_PROXY = "none";
    expect(clientIp(req({ "cf-connecting-ip": "203.0.113.9" }))).toBe("direct");
  });
});
