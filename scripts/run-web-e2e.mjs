import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(rootDir, "apps", "web");
const localPort = 4310;
const baseUrl = `http://127.0.0.1:${localPort}`;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npmCliPath = process.env.npm_execpath;
const require = createRequire(import.meta.url);

function needsWindowsCommandShell(command) {
  return process.platform === "win32" && command.toLowerCase().endsWith(".cmd");
}

function npmInvocation(args) {
  return npmCliPath
    ? { command: process.execPath, args: [npmCliPath, ...args] }
    : { command: npmCommand, args };
}

function runNpm(args, options) {
  const invocation = npmInvocation(args);
  return run(invocation.command, invocation.args, options);
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: needsWindowsCommandShell(command),
      ...options,
    });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(new Error(`${command} exited with ${signal || `code ${code}`}.`));
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return;
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    delay(timeoutMs),
  ]);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || !child.pid) return;

  if (process.platform === "win32") {
    try {
      await run("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
        cwd: rootDir,
        stdio: "ignore",
      });
    } catch {
      // The process can exit naturally between the initial check and taskkill.
    }
    await waitForExit(child, 5_000);
    return;
  }

  child.kill("SIGTERM");
  await waitForExit(child, 5_000);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function waitForServer(child) {
  const deadline = Date.now() + 45_000;
  let startError = null;
  child.once("error", (error) => {
    startError = error;
  });

  while (Date.now() < deadline) {
    if (startError) throw startError;
    if (child.exitCode !== null) {
      throw new Error(`Next exited before becoming ready (code ${child.exitCode}).`);
    }
    try {
      const response = await fetch(baseUrl, {
        headers: { Accept: "text/html" },
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // Next is still compiling or accepting its listening socket.
    }
    await delay(250);
  }

  throw new Error(`Next did not become ready at ${baseUrl} within 45 seconds.`);
}

function testEnvironment(dbPath) {
  return {
    ...process.env,
    BETTER_AUTH_SECRET: "e2e-only-auth-secret-not-for-production",
    BETTER_AUTH_URL: baseUrl,
    DB_PATH: dbPath,
    DISCORD_CLIENT_ID: "e2e-discord-client-id",
    DISCORD_CLIENT_SECRET: "e2e-discord-client-secret",
    EWC_DASHBOARD_DEV_AUTH_BYPASS: "true",
    EWC_DASHBOARD_DEV_AUTH_USER_ID: "dev-local-auth-user",
    EWC_DASHBOARD_INTERNAL_SECRET: "e2e-only-internal-secret",
    EWC_DASHBOARD_PUBLIC_URL: baseUrl,
    EWC_PUBLIC_MCP_ALLOWED_ORIGINS: baseUrl,
    EWC_PUBLIC_MCP_ENABLED: "true",
    EWC_PUBLIC_MCP_RATE_LIMIT_PER_MINUTE: "100",
    GOOGLE_ANALYTICS_MEASUREMENT_ID: "G-E2ETEST123",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

function playwrightCommand(args, environment) {
  const cli = require.resolve("@playwright/test/cli");
  return run(process.execPath, [cli, "test", "--config", "playwright.config.ts", ...args], {
    cwd: appDir,
    env: environment,
  });
}

async function main() {
  const forwardedArgs = process.argv.slice(2);
  const smokeMode = forwardedArgs[0] === "--smoke";
  const playwrightArgs = smokeMode ? forwardedArgs.slice(1) : forwardedArgs;

  if (!smokeMode && playwrightArgs.includes("--list")) {
    await playwrightCommand(playwrightArgs, process.env);
    return;
  }

  if (smokeMode && playwrightArgs.length) {
    throw new Error("web:smoke:local does not accept additional arguments.");
  }

  const tempRoot = await mkdir(join(rootDir, "data"), { recursive: true })
    .then(() => mkdtemp(join(rootDir, "data", "web-e2e-")));
  const dbPath = join(tempRoot, "dashboard.sqlite");
  const environment = testEnvironment(dbPath);
  let server;

  try {
    await runNpm(["run", "seed:dev"], { cwd: rootDir, env: environment });
    const nextInvocation = npmInvocation([
      "--workspace",
      "@esports-community-bot/web",
      "run",
      "dev",
      "--",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(localPort),
    ]);
    server = spawn(
      nextInvocation.command,
      nextInvocation.args,
      {
        cwd: rootDir,
        env: environment,
        shell: needsWindowsCommandShell(nextInvocation.command),
        stdio: "inherit",
      },
    );
    await waitForServer(server);

    if (smokeMode) {
      await run(process.execPath, [join(rootDir, "scripts", "smoke-public.mjs"), "--base-url", baseUrl], {
        cwd: rootDir,
        env: environment,
      });
    } else {
      await playwrightCommand(playwrightArgs, environment);
    }
  } finally {
    await stopServer(server);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
