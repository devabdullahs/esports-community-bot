import { describe, expect, test } from "vitest";
import { readBoundedJson } from "@/lib/request-body";

function jsonRequest(body: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

// A request whose body is a chunked stream with NO Content-Length header —
// the exact shape the streaming cap must handle.
function chunkedRequest(chunks: string[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: stream,
    // @ts-expect-error duplex is required by undici for stream bodies
    duplex: "half",
  });
}

describe("readBoundedJson", () => {
  test("parses a valid body at the exact byte boundary", async () => {
    const payload = JSON.stringify({ pad: "x".repeat(50) });
    const result = await readBoundedJson(jsonRequest(payload), payload.length);
    expect(result).toEqual({ ok: true, value: { pad: "x".repeat(50) } });
  });

  test("rejects one byte over the boundary as too_large", async () => {
    const payload = JSON.stringify({ pad: "x".repeat(50) });
    const result = await readBoundedJson(jsonRequest(payload), payload.length - 1);
    expect(result).toEqual({ ok: false, reason: "too_large" });
  });

  test("rejects an oversized declared Content-Length before reading", async () => {
    const request = jsonRequest("{}", { "Content-Length": "999999" });
    expect(await readBoundedJson(request, 1024)).toEqual({ ok: false, reason: "too_large" });
  });

  test("enforces the cap on chunked streams without Content-Length", async () => {
    const big = `"${"y".repeat(4096)}"`;
    const result = await readBoundedJson(chunkedRequest([big.slice(0, 100), big.slice(100)]), 1024);
    expect(result).toEqual({ ok: false, reason: "too_large" });
  });

  test("accepts a small chunked stream and parses it once complete", async () => {
    const result = await readBoundedJson(chunkedRequest(['{"a":', "1}"]), 1024);
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  test("malformed JSON inside the cap is invalid, not a throw", async () => {
    expect(await readBoundedJson(jsonRequest("{nope"), 1024)).toEqual({ ok: false, reason: "invalid" });
  });

  test("missing body is invalid", async () => {
    const request = new Request("http://localhost/api/test", { method: "POST" });
    expect(await readBoundedJson(request, 1024)).toEqual({ ok: false, reason: "invalid" });
  });
});
