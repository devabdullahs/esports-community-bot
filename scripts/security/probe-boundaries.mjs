import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import net from "node:net";
import tls from "node:tls";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const appDir = path.join(rootDir, "apps", "web");
const fixturePath = path.join(rootDir, "scripts", "security", "boundary-cases.json");
const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const options = {
    publicBase: null,
    originBase: null,
    reportPath: null,
    acknowledged: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--public-base") options.publicBase = argv[++index];
    else if (value === "--origin-base") options.originBase = argv[++index];
    else if (value === "--report") options.reportPath = argv[++index];
    else if (value === "--acknowledge-authorized-read-only") options.acknowledged = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  const deployed = Boolean(options.publicBase || options.originBase);
  if (deployed && !options.acknowledged) {
    throw new Error(
      "Deployed probes require --acknowledge-authorized-read-only and explicit approved base URLs.",
    );
  }
  return options;
}

function checkedBase(value, label) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${label} must use http or https.`);
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${label} must be a credential-free origin URL with no path, query, or fragment.`);
  }
  return url;
}

async function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) rejectPort(error);
        else if (port) resolvePort(port);
        else rejectPort(new Error("Could not allocate a loopback port."));
      });
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function waitForServer(child, base) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Next exited before becoming ready (code ${child.exitCode}).`);
    }
    try {
      const response = await fetch(new URL("/api/deployment-version", base), {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // The production server is still starting.
    }
    await delay(200);
  }
  throw new Error(`Next did not become ready at ${base.origin}.`);
}

async function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode !== null) return;
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    delay(timeoutMs),
  ]);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
    });
    await new Promise((resolveKill) => killer.once("exit", resolveKill));
  } else {
    child.kill("SIGTERM");
  }
  await waitForExit(child, 5_000);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function startLocalServer() {
  const buildId = path.join(appDir, ".next", "BUILD_ID");
  try {
    await readFile(buildId, "utf8");
  } catch {
    throw new Error("Missing production build. Run `npm run web:build` first.");
  }

  const port = await freePort();
  const base = new URL(`http://127.0.0.1:${port}`);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ecb-boundary-"));
  const nextCli = require.resolve("next/dist/bin/next", { paths: [appDir] });
  const environment = {
    ...process.env,
    BETTER_AUTH_SECRET: "boundary-only-auth-secret-with-at-least-32-bytes",
    BETTER_AUTH_URL: base.origin,
    DB_PATH: path.join(tempRoot, "boundary.sqlite"),
    DISCORD_CLIENT_ID: "boundary-client-id",
    DISCORD_CLIENT_SECRET: "boundary-client-secret",
    EWC_DASHBOARD_INTERNAL_PROFILE_SYNC_SECRET: "p".repeat(64),
    EWC_DASHBOARD_INTERNAL_NEWS_REVALIDATE_SECRET: "n".repeat(64),
    EWC_DASHBOARD_PUBLIC_URL: base.origin,
    EWC_MCP_ENABLED: "true",
    EWC_PUBLIC_MCP_ENABLED: "true",
    EWC_TRUSTED_PROXY: "none",
    EWC_ORIGIN_SHIELDED: "false",
    NEXT_TELEMETRY_DISABLED: "1",
  };
  const child = spawn(
    process.execPath,
    [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: appDir,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => { output = `${output}${chunk}`.slice(-8_000); });
  child.stderr.on("data", (chunk) => { output = `${output}${chunk}`.slice(-8_000); });
  try {
    await waitForServer(child, base);
  } catch (error) {
    await stopServer(child);
    await rm(tempRoot, { recursive: true, force: true });
    throw new Error(`${error instanceof Error ? error.message : error}\n${output}`);
  }
  return { base, child, tempRoot };
}

function decodeChunked(buffer) {
  const chunks = [];
  let offset = 0;
  while (offset < buffer.length) {
    const lineEnd = buffer.indexOf("\r\n", offset);
    if (lineEnd < 0) break;
    const sizeText = buffer.subarray(offset, lineEnd).toString("ascii").split(";", 1)[0];
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isFinite(size)) break;
    if (size === 0) return Buffer.concat(chunks);
    const start = lineEnd + 2;
    const end = start + size;
    if (end > buffer.length) break;
    chunks.push(buffer.subarray(start, end));
    offset = end + 2;
  }
  return Buffer.concat(chunks);
}

function parseRawResponse(buffer) {
  const headerEnd = buffer.indexOf("\r\n\r\n");
  if (headerEnd < 0) throw new Error("Response did not contain a complete HTTP header.");
  const head = buffer.subarray(0, headerEnd).toString("latin1");
  const lines = head.split("\r\n");
  const statusMatch = lines.shift()?.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/);
  if (!statusMatch) throw new Error("Response had an invalid status line.");
  const headers = new Map();
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    headers.set(name, headers.has(name) ? `${headers.get(name)}, ${value}` : value);
  }
  let body = buffer.subarray(headerEnd + 4);
  if (headers.get("transfer-encoding")?.toLowerCase().includes("chunked")) {
    body = decodeChunked(body);
  }
  return { status: Number(statusMatch[1]), headers, body };
}

async function rawRequest(base, fixture) {
  const port = Number(base.port || (base.protocol === "https:" ? 443 : 80));
  const target = fixture.target.replaceAll("{{BASE_ORIGIN}}", base.origin);
  const body = Buffer.from(fixture.body ?? "", "utf8");
  const host = fixture.host || base.host;
  const request = [
    `${fixture.method} ${target} HTTP/1.1`,
    `Host: ${host}`,
    "Accept: application/json, text/html;q=0.9",
    "Accept-Encoding: identity",
    "Connection: close",
    ...(body.length ? ["Content-Type: application/json"] : []),
    `Content-Length: ${body.length}`,
    "",
    "",
  ].join("\r\n");

  return new Promise((resolveResponse, rejectResponse) => {
    const chunks = [];
    const socket = base.protocol === "https:"
      ? tls.connect({ host: base.hostname, port, servername: base.hostname })
      : net.connect({ host: base.hostname, port });
    socket.setTimeout(10_000);
    socket.once("secureConnect", () => {
      if (base.protocol === "https:") socket.write(request);
    });
    socket.once("connect", () => {
      if (base.protocol === "http:") socket.write(request);
    });
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.once("timeout", () => socket.destroy(new Error("Request timed out.")));
    socket.once("error", rejectResponse);
    socket.once("end", () => {
      try {
        resolveResponse(parseRawResponse(Buffer.concat(chunks)));
      } catch (error) {
        rejectResponse(error);
      }
    });
    if (body.length) {
      const event = base.protocol === "https:" ? "secureConnect" : "connect";
      socket.once(event, () => socket.write(body));
    }
  });
}

function contentType(headers) {
  const value = headers.get("content-type")?.toLowerCase() || "";
  if (value.includes("application/json") || value.includes("+json")) return "json";
  if (value.includes("text/html")) return "html";
  if (value.includes("text/")) return "text";
  return value ? "binary" : "empty";
}

function bodyShape(response) {
  if (!response.body.length) return "empty";
  if (contentType(response.headers) === "json") {
    try {
      const value = JSON.parse(response.body.toString("utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) return "json:non-object";
      const keys = Object.keys(value).sort();
      const details = [];
      if (typeof value.code === "string") details.push(`code=${value.code}`);
      if (typeof value.error === "string") details.push(`error=${value.error}`);
      details.push(`keys=${keys.join(",")}`);
      return `json:${details.join(";")}`;
    } catch {
      return "json:invalid";
    }
  }
  return contentType(response.headers) === "html" ? "html" : "text";
}

function normalizedLocation(headers, base) {
  const raw = headers.get("location");
  if (!raw) return null;
  try {
    const value = new URL(raw, base);
    return `${value.pathname}${value.search}`;
  } catch {
    return "invalid";
  }
}

function isPublicCache(headers) {
  const values = [
    headers.get("cache-control") || "",
    headers.get("cloudflare-cdn-cache-control") || "",
    headers.get("cdn-cache-control") || "",
  ].join(",");
  return /(?:^|,)\s*public(?:\s|,|$)/i.test(values);
}

function fingerprint(response, base) {
  return {
    status: response.status,
    contentType: contentType(response.headers),
    bodyShape: bodyShape(response),
    location: normalizedLocation(response.headers, base),
    capability: response.headers.get("x-ec-internal-capability") || null,
    allow: response.headers.get("allow") || null,
    publicCache: isPublicCache(response.headers),
  };
}

function comparable(expected) {
  const { routeClass: _routeClass, ...value } = expected;
  return value;
}

function sameFingerprint(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function deploymentVersion(base) {
  try {
    const response = await fetch(new URL("/api/deployment-version", base), {
      signal: AbortSignal.timeout(5_000),
    });
    const payload = await response.json();
    return typeof payload.version === "string" ? payload.version : null;
  } catch {
    return null;
  }
}

async function probeMode({ mode, base, fixtures }) {
  const results = [];
  for (const fixture of fixtures.cases) {
    const response = await rawRequest(base, fixture);
    const actual = fingerprint(response, base);
    const expectedName = fixture.expected[mode];
    const expected = fixtures.fingerprints[expectedName];
    if (!expected) throw new Error(`Unknown expected fingerprint ${expectedName}.`);
    const matchedEntry = Object.entries(fixtures.fingerprints)
      .find(([, candidate]) => sameFingerprint(actual, comparable(candidate)));
    const actualRouteClass = matchedEntry?.[1].routeClass || "unknown";
    const passed = sameFingerprint(actual, comparable(expected));
    results.push({
      id: fixture.id,
      method: fixture.method,
      target: fixture.target,
      expected: {
        name: expectedName,
        routeClass: expected.routeClass,
        fingerprint: comparable(expected),
      },
      actual: {
        routeClass: actualRouteClass,
        fingerprint: actual,
      },
      passed,
    });
  }
  return {
    mode,
    base: base.origin,
    deploymentVersion: await deploymentVersion(base),
    passed: results.every((result) => result.passed),
    results,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const fixtures = JSON.parse(await readFile(fixturePath, "utf8"));
  const modes = [];
  let local = null;
  try {
    if (!options.publicBase && !options.originBase) {
      local = await startLocalServer();
      modes.push({ mode: "local", base: local.base });
    } else {
      if (options.publicBase) {
        modes.push({ mode: "public", base: checkedBase(options.publicBase, "--public-base") });
      }
      if (options.originBase) {
        modes.push({ mode: "origin", base: checkedBase(options.originBase, "--origin-base") });
      }
    }

    const reports = [];
    for (const mode of modes) reports.push(await probeMode({ ...mode, fixtures }));
    const report = {
      schemaVersion: 1,
      fixtureVersion: fixtures.version,
      generatedAt: new Date().toISOString(),
      harmless: true,
      credentialsSent: false,
      passed: reports.every((entry) => entry.passed),
      modes: reports,
    };
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (options.reportPath) await writeFile(path.resolve(options.reportPath), serialized, "utf8");
    process.stdout.write(serialized);
    if (!report.passed) process.exitCode = 1;
  } finally {
    if (local) {
      await stopServer(local.child);
      await rm(local.tempRoot, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
