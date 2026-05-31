// Tiny leveled logger. Level is controlled by LOG_LEVEL (error|warn|info|debug).
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const current = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

function emit(level, args) {
  if (LEVELS[level] > current) return;
  const tag = level.toUpperCase().padEnd(5);
  const line = `[${new Date().toISOString()}] ${tag}`;
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(line, ...args);
}

export const logger = {
  error: (...a) => emit('error', a),
  warn: (...a) => emit('warn', a),
  info: (...a) => emit('info', a),
  debug: (...a) => emit('debug', a),
};
