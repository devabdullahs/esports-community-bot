import { afterEach, describe, expect, it, vi } from "vitest";
import { indexNowKey, submitIndexNowUrls } from "@/lib/indexnow";
import { GET as getIndexNowKey } from "@/app/[key]/route";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.EWC_INDEXNOW_ENABLED;
  delete process.env.EWC_INDEXNOW_KEY;
  delete process.env.EWC_DASHBOARD_PUBLIC_URL;
});

describe("IndexNow", () => {
  it("fails closed when disabled or configured with an invalid key", () => {
    process.env.EWC_INDEXNOW_ENABLED = "true";
    process.env.EWC_INDEXNOW_KEY = "short";
    expect(indexNowKey()).toBeNull();
  });

  it("submits only same-origin canonical URLs with an explicit key location", async () => {
    process.env.EWC_INDEXNOW_ENABLED = "true";
    process.env.EWC_INDEXNOW_KEY = "test-indexnow-key-1234567890";
    process.env.EWC_DASHBOARD_PUBLIC_URL = "https://esportscommunity.net";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await submitIndexNowUrls([
      "https://esportscommunity.net/news/1",
      "https://esportscommunity.net/news/1",
      "https://attacker.example/news/1",
    ]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.host).toBe("esportscommunity.net");
    expect(body.keyLocation).toBe(
      "https://esportscommunity.net/test-indexnow-key-1234567890.txt",
    );
    expect(body.urlList).toEqual(["https://esportscommunity.net/news/1"]);
  });

  it("serves verification only at the entropy-bearing configured path", async () => {
    process.env.EWC_INDEXNOW_ENABLED = "true";
    process.env.EWC_INDEXNOW_KEY = "test-indexnow-key-1234567890";
    const request = new Request("https://esportscommunity.net/value.txt");

    const missing = await getIndexNowKey(request, {
      params: Promise.resolve({ key: "guess.txt" }),
    });
    expect(missing.status).toBe(404);
    const found = await getIndexNowKey(request, {
      params: Promise.resolve({ key: "test-indexnow-key-1234567890.txt" }),
    });
    expect(found.status).toBe(200);
    expect(await found.text()).toBe("test-indexnow-key-1234567890");
  });
});
