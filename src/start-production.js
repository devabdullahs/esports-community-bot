import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const webDir = resolve(rootDir, 'apps/web');
const binSuffix = process.platform === 'win32' ? '.cmd' : '';
const nextBin = resolve(rootDir, 'node_modules/.bin', `next${binSuffix}`);

const services = [];
const children = new Map();
const exited = new Set();
let shuttingDown = false;
let exitCode = 0;

function enabled(name) {
  return process.env[name] !== 'false';
}

function addService(name, command, args, options = {}) {
  services.push({ name, command, args, options });
}

if (enabled('RUN_BOT')) {
  addService('bot', process.execPath, ['src/index.js'], { cwd: rootDir });
}

if (enabled('RUN_WEB')) {
  // Bind all interfaces by default. Do NOT fall back to process.env.HOSTNAME:
  // Docker sets it to the container ID, so Next would listen on a single hostname
  // the platform router / health-probe can't reach (caused a full-site 404 once).
  const host = process.env.WEB_HOST || '0.0.0.0';
  const port = process.env.WEB_PORT || process.env.PORT || '3000';
  addService('web', nextBin, ['start', '--hostname', host, '--port', port], { cwd: webDir });
}

function finishIfDone() {
  if (exited.size === children.size) process.exit(exitCode);
}

function shutdown(signal = 'SIGTERM') {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children.values()) {
    if (!child.killed) child.kill(signal);
  }

  setTimeout(() => {
    for (const child of children.values()) {
      if (!child.killed) child.kill('SIGKILL');
    }
  }, 10_000).unref();

  finishIfDone();
}

if (!services.length) {
  console.error('[start] No services enabled. Set RUN_BOT and/or RUN_WEB to true.');
  process.exit(1);
}

for (const service of services) {
  const child = spawn(service.command, service.args, {
    cwd: service.options.cwd,
    env: process.env,
    stdio: 'inherit',
  });
  children.set(service.name, child);
  console.log(`[start] ${service.name} started (pid ${child.pid})`);

  child.on('exit', (code, signal) => {
    exited.add(service.name);
    if (!shuttingDown) {
      exitCode = code ?? (signal ? 1 : 0);
      console.error(`[start] ${service.name} exited (${signal || code}); stopping container.`);
      shutdown();
    } else {
      if (code && exitCode === 0) exitCode = code;
      finishIfDone();
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
