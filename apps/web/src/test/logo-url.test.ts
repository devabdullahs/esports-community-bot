import { describe, expect, test } from "vitest";
import { GET as logoGET } from "@/app/api/logo/route";
import { logoProxyUrl } from "@/lib/logo-url";

describe("logoProxyUrl", () => {
  test("builds a local logo proxy URL for Liquipedia thumbnails", () => {
    expect(
      logoProxyUrl(
        "https://liquipedia.net/commons/images/thumb/a/a5/BetBoom_Team_lightmode.png/64px-BetBoom_Team_lightmode.png",
      ),
    ).toBe(
      "/api/logo?url=https%3A%2F%2Fliquipedia.net%2Fcommons%2Fimages%2Fthumb%2Fa%2Fa5%2FBetBoom_Team_lightmode.png%2F64px-BetBoom_Team_lightmode.png",
    );
  });

  test("trims and encodes the source URL", () => {
    expect(logoProxyUrl(" https://liquipedia.net/commons/images/a/a5/BetBoom Team.png ")).toBe(
      "/api/logo?url=https%3A%2F%2Fliquipedia.net%2Fcommons%2Fimages%2Fa%2Fa5%2FBetBoom%20Team.png",
    );
  });
});

describe("GET /api/logo", () => {
  test("rejects non-Liquipedia logo URLs without proxying", async () => {
    const response = await logoGET(new Request("http://localhost/api/logo?url=https%3A%2F%2Fexample.com%2Flogo.png"));
    expect(response.status).toBe(400);
  });
});
