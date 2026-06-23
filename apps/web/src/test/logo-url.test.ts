import { beforeEach, describe, expect, test, vi } from "vitest";
import { loadLogoBytes } from "@bot/lib/logoSource.js";
import { GET as logoGET } from "@/app/api/logo/route";
import { logoProxyUrl } from "@/lib/logo-url";

vi.mock("@bot/lib/logoSource.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bot/lib/logoSource.js")>();
  return {
    ...actual,
    loadLogoBytes: vi.fn(),
  };
});

const mockedLoadLogoBytes = vi.mocked(loadLogoBytes);
const liquipediaLogo = "https://liquipedia.net/commons/images/0/00/Esports_Community_Test_Logo.png";

beforeEach(() => {
  mockedLoadLogoBytes.mockReset();
});

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
    expect(mockedLoadLogoBytes).not.toHaveBeenCalled();
  });

  test("does not fetch uncached Liquipedia logos from public web views by default", async () => {
    mockedLoadLogoBytes.mockResolvedValue(null);
    const previous = process.env.WEB_LOGO_PROXY_DOWNLOADS;
    delete process.env.WEB_LOGO_PROXY_DOWNLOADS;
    try {
      const response = await logoGET(new Request(`http://localhost/api/logo?url=${encodeURIComponent(liquipediaLogo)}`));
      expect(response.status).toBe(404);
      expect(mockedLoadLogoBytes).toHaveBeenCalledWith(liquipediaLogo, "web", { download: false });
    } finally {
      if (previous == null) delete process.env.WEB_LOGO_PROXY_DOWNLOADS;
      else process.env.WEB_LOGO_PROXY_DOWNLOADS = previous;
    }
  });

  test("does not serve cached SVG as same-origin active content", async () => {
    mockedLoadLogoBytes.mockResolvedValue({
      bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script /></svg>'),
      cached: true,
      file: "cached.svg",
    });

    const response = await logoGET(new Request(`http://localhost/api/logo?url=${encodeURIComponent(liquipediaLogo)}`));

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).not.toBe("image/svg+xml");
  });

  test("serves cached raster logo bytes with a raster content type", async () => {
    mockedLoadLogoBytes.mockResolvedValue({
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      cached: true,
      file: "cached.png",
    });

    const response = await logoGET(new Request(`http://localhost/api/logo?url=${encodeURIComponent(liquipediaLogo)}`));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
  });
});
