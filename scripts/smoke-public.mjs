import process from "node:process";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 60_000;

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== "--base-url" && argument !== "--timeout-ms") {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value.`);
    }
    options[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  return options;
}

function resolveBaseUrl(value) {
  if (!value) throw new Error("Set --base-url or EWC_PUBLIC_URL before running the public smoke check.");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The public smoke base URL must be an absolute HTTP(S) URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The public smoke base URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("The public smoke base URL must not contain credentials.");
  }
  url.search = "";
  url.hash = "";
  return url;
}

function resolveTimeout(value) {
  if (!value) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_TIMEOUT_MS || parsed > MAX_TIMEOUT_MS) {
    throw new Error(`--timeout-ms must be an integer from ${MIN_TIMEOUT_MS} to ${MAX_TIMEOUT_MS}.`);
  }
  return parsed;
}

function endpoint(baseUrl, pathname) {
  return new URL(pathname, baseUrl.origin).toString();
}

function redactedUrl(value) {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

function contentType(response) {
  return response.headers.get("content-type")?.toLowerCase() || "";
}

function assertStatus(response, target) {
  if (response.status !== 200) {
    throw new Error(`${target.method} ${redactedUrl(target.url)} returned ${response.status}.`);
  }
}

function assertContentType(response, target) {
  const accepted = target.contentTypes ?? [target.contentType];
  if (!accepted.some((type) => contentType(response).includes(type))) {
    throw new Error(`${describe(target)} returned an unexpected content type.`);
  }
}

// Several targets share the /api/public-mcp path, so the path alone no longer
// identifies which probe failed.
function describe(target) {
  const where = `${target.method} ${redactedUrl(target.url)}`;
  return target.label ? `${where} (${target.label})` : where;
}

// The MCP endpoint answers a 2026-07-28 request with a JSON object and a
// handshake-era request with an SSE stream, so the payload is pulled out of
// whichever form arrived.
function parseMcpPayload(body, target) {
  try {
    return JSON.parse(body);
  } catch {
    const data = body
      .split(/\r?\n/)
      .find((line) => line.startsWith("data: "))
      ?.slice(6);
    if (!data) throw new Error(`${describe(target)} did not return a JSON-RPC payload.`);
    try {
      return JSON.parse(data);
    } catch {
      throw new Error(`${describe(target)} returned an unreadable SSE payload.`);
    }
  }
}

function assertPublicHtml(body, target) {
  if (!/<html\b/i.test(body)) {
    throw new Error(`${target.method} ${redactedUrl(target.url)} did not return an HTML document.`);
  }
  const robotsTags = body.match(/<meta\b[^>]*>/gi) || [];
  if (robotsTags.some((tag) => /\bname=["']robots["']/i.test(tag) && /\bnoindex\b/i.test(tag))) {
    throw new Error(`${target.method} ${redactedUrl(target.url)} unexpectedly declares noindex.`);
  }
  if (target.locale === "en" && (!/<html\b[^>]*\blang=["']en["']/i.test(body) || !/<html\b[^>]*\bdir=["']ltr["']/i.test(body))) {
    throw new Error(`${target.method} ${redactedUrl(target.url)} is missing English direction markers.`);
  }
  if (target.locale === "ar" && (!/<html\b[^>]*\blang=["']ar["']/i.test(body) || !/<html\b[^>]*\bdir=["']rtl["']/i.test(body))) {
    throw new Error(`${target.method} ${redactedUrl(target.url)} is missing Arabic direction markers.`);
  }
}

async function fetchTarget(target, timeoutMs) {
  let response;
  try {
    response = await fetch(target.url, {
      method: target.method,
      headers: target.body
        ? {
            Accept: "application/json, text/event-stream",
            "Content-Type": "application/json",
            ...target.headers,
          }
        : undefined,
      body: target.body ? JSON.stringify(target.body) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "could not be reached";
    throw new Error(`${describe(target)} ${reason}.`);
  }

  assertStatus(response, target);
  assertContentType(response, target);
  return response;
}

const MODERN_PROTOCOL_VERSION = "2026-07-28";

function modernParams(extra = {}) {
  return {
    ...extra,
    _meta: {
      "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL_VERSION,
      "io.modelcontextprotocol/clientInfo": { name: "public-smoke", version: "1.0.0" },
      "io.modelcontextprotocol/clientCapabilities": {},
    },
  };
}

function modernHeaders(method) {
  return { "MCP-Protocol-Version": MODERN_PROTOCOL_VERSION, "Mcp-Method": method };
}

function mcpTargets(baseUrl) {
  const url = endpoint(baseUrl, "/api/public-mcp");
  const contentTypes = ["application/json", "text/event-stream"];
  return [
    {
      method: "POST",
      url,
      contentTypes,
      label: "2026-07-28 server/discover",
      headers: modernHeaders("server/discover"),
      body: { jsonrpc: "2.0", id: "smoke-discover", method: "server/discover", params: modernParams() },
      assertResult: (result, target) => {
        if (!result.supportedVersions?.includes(MODERN_PROTOCOL_VERSION)) {
          throw new Error(`${describe(target)} does not advertise ${MODERN_PROTOCOL_VERSION}.`);
        }
        if (!result.capabilities?.tools) {
          throw new Error(`${describe(target)} does not advertise the tools capability.`);
        }
      },
    },
    {
      method: "POST",
      url,
      contentTypes,
      label: "2026-07-28 tools/list",
      headers: modernHeaders("tools/list"),
      body: { jsonrpc: "2.0", id: "smoke-modern-list", method: "tools/list", params: modernParams() },
      assertResult: (result, target) => {
        if (!Array.isArray(result.tools) || result.tools.length === 0) {
          throw new Error(`${describe(target)} did not return any tools.`);
        }
        if (result.resultType !== "complete") {
          throw new Error(`${describe(target)} is missing resultType "complete".`);
        }
        // The public tool set is identical for every caller; anything else here
        // would mean a shared cache is being told it may not hold it.
        if (result.cacheScope !== "public" || !Number.isInteger(result.ttlMs)) {
          throw new Error(`${describe(target)} returned unusable cache hints.`);
        }
      },
    },
    {
      method: "POST",
      url,
      contentTypes,
      // Dual-era coverage: the handshake era is deprecated for removal on
      // 2026-11-23, and until then breaking it is a regression. Drop this target
      // on that date, not before.
      label: "handshake-era tools/list",
      body: { jsonrpc: "2.0", id: "smoke-legacy-list", method: "tools/list", params: {} },
      assertResult: (result, target) => {
        if (!Array.isArray(result.tools) || result.tools.length === 0) {
          throw new Error(`${describe(target)} did not return any tools.`);
        }
        if (result.resultType !== undefined) {
          throw new Error(`${describe(target)} leaked 2026-07-28 fields into a handshake-era answer.`);
        }
      },
    },
  ];
}

async function runSmokeCheck({ baseUrl, timeoutMs }) {
  const targets = [
    { method: "GET", url: endpoint(baseUrl, "/"), contentType: "text/html", locale: "en" },
    { method: "GET", url: endpoint(baseUrl, "/ar"), contentType: "text/html", locale: "ar" },
    { method: "GET", url: endpoint(baseUrl, "/games"), contentType: "text/html" },
    { method: "GET", url: endpoint(baseUrl, "/tournaments"), contentType: "text/html" },
    { method: "GET", url: endpoint(baseUrl, "/docs/mcp"), contentType: "text/html" },
    { method: "GET", url: endpoint(baseUrl, "/robots.txt"), contentType: "text/plain" },
    { method: "GET", url: endpoint(baseUrl, "/sitemap.xml"), contentType: "xml" },
    ...mcpTargets(baseUrl),
  ];

  for (const target of targets) {
    const response = await fetchTarget(target, timeoutMs);
    if (baseUrl.protocol === "https:" && !response.headers.get("strict-transport-security")) {
      throw new Error(`${describe(target)} is missing Strict-Transport-Security.`);
    }
    const body = await response.text();
    if (target.contentType === "text/html") assertPublicHtml(body, target);
    if (target.assertResult) {
      const payload = parseMcpPayload(body, target);
      if (payload?.error) {
        throw new Error(`${describe(target)} returned JSON-RPC error ${payload.error.code}.`);
      }
      if (!payload?.result) {
        throw new Error(`${describe(target)} did not return a JSON-RPC result.`);
      }
      target.assertResult(payload.result, target);
    }
    console.log(`OK ${target.method} ${new URL(target.url).pathname}${target.label ? ` — ${target.label}` : ""}`);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  await runSmokeCheck({
    baseUrl: resolveBaseUrl(options.baseUrl || process.env.EWC_PUBLIC_URL),
    timeoutMs: resolveTimeout(options.timeoutMs || process.env.SMOKE_TIMEOUT_MS),
  });
}

export { runSmokeCheck, resolveBaseUrl, resolveTimeout };

// Exported for tests, so only run the probe when this file is the entry point.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
