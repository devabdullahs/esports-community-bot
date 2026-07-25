// Bounded request-body admission (security hardening ECB-SEC-001/005/006/007).
//
// `request.json()` buffers the entire stream before parsing, so a client that
// omits Content-Length (or lies about it) can make the process allocate an
// arbitrarily large string before any route-level check runs. This primitive
// enforces the byte cap on the STREAM itself: it counts actual bytes as they
// arrive, cancels the reader the moment the cap is exceeded, and only then
// decodes + parses the bounded buffer. Content-Length is used purely as an
// early-rejection optimization — it is never the enforcement point.

export type RequestBodyFailureReason = "too_large" | "invalid";

type BoundedResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: RequestBodyFailureReason };

export type BoundedJsonResult<T = unknown> = BoundedResult<T>;
export type BoundedFormDataResult = BoundedResult<FormData>;

async function readBoundedBytes(
  request: Request,
  maxBytes: number,
): Promise<BoundedResult<Uint8Array>> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    return { ok: false, reason: "invalid" };
  }

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
  return { ok: true, value: buffer };
}

export async function readBoundedJson<T = unknown>(
  request: Request,
  maxBytes: number,
): Promise<BoundedJsonResult<T>> {
  const result = await readBoundedBytes(request, maxBytes);
  if (!result.ok) return result;
  try {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(result.value);
    return { ok: true, value: JSON.parse(text) as T };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

export function requestBodyErrorResponse(reason: RequestBodyFailureReason): Response {
  const tooLarge = reason === "too_large";
  return Response.json(
    { error: tooLarge ? "Request body is too large." : "Invalid request body." },
    { status: tooLarge ? 413 : 400 },
  );
}

export async function readBoundedFormData(
  request: Request,
  maxBytes: number,
): Promise<BoundedFormDataResult> {
  const result = await readBoundedBytes(request, maxBytes);
  if (!result.ok) return result;

  const contentType = request.headers.get("content-type");
  if (!contentType) return { ok: false, reason: "invalid" };

  try {
    const body = new Uint8Array(result.value.byteLength);
    body.set(result.value);
    const bounded = new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: body.buffer,
    });
    return { ok: true, value: await bounded.formData() };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
