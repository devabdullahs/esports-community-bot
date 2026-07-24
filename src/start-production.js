import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensurePostgresMigrations, sanitizePostgresError } from './db/client.js';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const webDir = resolve(rootDir, 'apps/web');
const binSuffix = process.platform === 'win32' ? '.cmd' : '';
const nextBin = resolve(rootDir, 'node_modules/.bin', 'next' + binSuffix);

function enabled(env, name) {
  return env[name] !== 'false';
}

export function createProductionServices(env = process.env) {
  const services = [];
  if (enabled(env, 'RUN_BOT')) {
    services.push({ name: 'bot', command: process.execPath, args: ['src/index.js'], cwd: rootDir });
  }

  if (enabled(env, 'RUN_WEB')) {
    // Do not fall back to HOSTNAME: Docker sets it to the container ID, which
    // makes Next listen on an address the platform router cannot reach.
    const host = env.WEB_HOST || '0.0.0.0';
    const port = env.WEB_PORT || env.PORT || '3000';
    services.push({
      name: 'web',
      command: nextBin,
      args: ['start', '--hostname', host, '--port', port],
      cwd: webDir,
    });
  }

  return services;
}

function spawnService(service, { env, spawnImpl, logger }) {
  const child = spawnImpl(service.command, service.args, {
    cwd: service.cwd,
    env,
    stdio: 'inherit',
  });
  logger.log('[start] ' + service.name + ' started (pid ' + child.pid + ')');
  return child;
}

export async function startProduction({
  env = process.env,
  migrate = ensurePostgresMigrations,
  spawnImpl = spawn,
  logger = console,
  waitForExit = true,
  signalSource = process,
  setTimeoutImpl = setTimeout,
} = {}) {
  const services = createProductionServices(env);
  if (!services.length) {
    logger.error('[start] No services enabled. Set RUN_BOT and/or RUN_WEB to true.');
    return 1;
  }

  try {
    await migrate();
  } catch (error) {
    logger.error('[start] PostgreSQL migrations failed: ' + sanitizePostgresError(error, env.DATABASE_URL));
    return 1;
  }

  if (!waitForExit) {
    return {
      exitCode: 0,
      services,
      children: new Map(services.map((service) => [service.name, spawnService(service, { env, spawnImpl, logger })])),
    };
  }

  return new Promise((resolve) => {
    const children = new Map();
    const exited = new Set();
    let shuttingDown = false;
    let exitCode = 0;

    function finishIfDone() {
      if (exited.size === children.size) resolve(exitCode);
    }

    function shutdown(signal = 'SIGTERM') {
      if (shuttingDown) return;
      shuttingDown = true;

      for (const child of children.values()) {
        if (!child.killed) child.kill(signal);
      }

      setTimeoutImpl(() => {
        for (const child of children.values()) {
          if (!child.killed) child.kill('SIGKILL');
        }
      }, 10_000).unref();

      finishIfDone();
    }

    for (const service of services) {
      const child = spawnService(service, { env, spawnImpl, logger });
      children.set(service.name, child);

      child.once('error', (error) => {
        exited.add(service.name);
        exitCode = 1;
        logger.error('[start] unable to start ' + service.name + ': ' + sanitizePostgresError(error, env.DATABASE_URL));
        shutdown();
      });
      child.once('exit', (code, signal) => {
        exited.add(service.name);
        if (!shuttingDown) {
          exitCode = code ?? (signal ? 1 : 0);
          logger.error('[start] ' + service.name + ' exited (' + (signal || code) + '); stopping container.');
          shutdown();
        } else {
          if (code && exitCode === 0) exitCode = code;
          finishIfDone();
        }
      });
    }

    signalSource.once('SIGINT', () => shutdown('SIGINT'));
    signalSource.once('SIGTERM', () => shutdown('SIGTERM'));
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  process.exitCode = await startProduction();
}
