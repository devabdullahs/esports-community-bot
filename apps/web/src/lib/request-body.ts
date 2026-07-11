// Bounded request-body admission (security hardening ECB-SEC-001/005/006/007).
//
// `request.json()` buffers the entire stream before parsing, so a client that
// omits Content-Length (or lies about it) can make the process allocate an
// arbitrarily large string before any route-level check runs. This primitive
// enforces the byte cap on the STREAM itself: it counts actual bytes as they
// arrive, cancels the reader the moment the cap is exceeded, and only then
// decodes + parses the bounded buffer. Content-Length is used purely as an
// early-rejection optimization — it is never the enforcement point.

export type BoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "too_large" | "invalid" };

export async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<BoundedJsonResult> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, reason: "too_large" };
  }

  const body = request.body;
  if (!body) return { ok: false, reason: "invalid" };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "invalid" };
  } finally {
    reader.releaseLock();
  }

  const buffer = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
