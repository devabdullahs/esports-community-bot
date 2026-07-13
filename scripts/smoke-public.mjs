import process from "node:process";

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
  if (!contentType(response).includes(target.contentType)) {
    throw new Error(`${target.method} ${redactedUrl(target.url)} returned an unexpected content type.`);
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
          }
        : undefined,
      body: target.body ? JSON.stringify(target.body) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "could not be reached";
    throw new Error(`${target.method} ${redactedUrl(target.url)} ${reason}.`);
  }

  assertStatus(response, target);
  assertContentType(response, target);
  return response;
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
    {
      method: "POST",
      url: endpoint(baseUrl, "/api/public-mcp"),
      contentType: "application/json",
      body: { jsonrpc: "2.0", id: "public-smoke-tools-list", method: "tools/list", params: {} },
    },
  ];

  for (const target of targets) {
    const response = await fetchTarget(target, timeoutMs);
    if (baseUrl.protocol === "https:" && !response.headers.get("strict-transport-security")) {
      throw new Error(`${target.method} ${redactedUrl(target.url)} is missing Strict-Transport-Security.`);
    }
    const body = await response.text();
    if (target.contentType === "text/html") assertPublicHtml(body, target);
    if (target.url.endsWith("/api/public-mcp")) {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        throw new Error(`POST ${redactedUrl(target.url)} did not return JSON.`);
      }
      if (!Array.isArray(payload?.result?.tools)) {
        throw new Error(`POST ${redactedUrl(target.url)} did not return a tools/list result.`);
      }
    }
    console.log(`OK ${target.method} ${new URL(target.url).pathname}`);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  await runSmokeCheck({
    baseUrl: resolveBaseUrl(options.baseUrl || process.env.EWC_PUBLIC_URL),
    timeoutMs: resolveTimeout(options.timeoutMs || process.env.SMOKE_TIMEOUT_MS),
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
