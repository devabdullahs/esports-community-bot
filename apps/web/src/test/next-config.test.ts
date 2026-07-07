import { describe, expect, test } from "vitest";
import { contentSecurityPolicy } from "../../next.config";

describe("next.config security headers", () => {
  test("production CSP allows every co-stream iframe host", () => {
    expect(contentSecurityPolicy).toContain("https://player.twitch.tv");
    expect(contentSecurityPolicy).toContain("https://player.kick.com");
    expect(contentSecurityPolicy).toContain("https://www.youtube.com");
    expect(contentSecurityPolicy).toContain("https://www.youtube-nocookie.com");
  });
});
