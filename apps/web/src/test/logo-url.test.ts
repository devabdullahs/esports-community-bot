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

  test("does not fetch uncached Liquipedia logos from public web views by default", async () => {
    const previous = process.env.WEB_LOGO_PROXY_DOWNLOADS;
    delete process.env.WEB_LOGO_PROXY_DOWNLOADS;
    const source =
      "https://liquipedia.net/commons/images/0/00/Esports_Community_Test_Logo_Not_Cached.png";
    try {
      const response = await logoGET(new Request(`http://localhost/api/logo?url=${encodeURIComponent(source)}`));
      expect(response.status).toBe(404);
    } finally {
      if (previous == null) delete process.env.WEB_LOGO_PROXY_DOWNLOADS;
      else process.env.WEB_LOGO_PROXY_DOWNLOADS = previous;
    }
  });
});
