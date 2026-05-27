/* Tiny leveled logger — no external dependency. */
type Level = "info" | "warn" | "error" | "debug";

const colors: Record<Level, string> = {
  info: "\x1b[36m", // cyan
  warn: "\x1b[33m", // yellow
  error: "\x1b[31m", // red
  debug: "\x1b[90m", // gray
};
const reset = "\x1b[0m";

function log(level: Level, msg: string, meta?: unknown) {
  const ts = new Date().toISOString();
  const tag = `${colors[level]}${level.toUpperCase()}${reset}`;
  // eslint-disable-next-line no-console
  console.log(`${ts} ${tag} ${msg}`, meta !== undefined ? meta : "");
}

export const logger = {
  info: (m: string, meta?: unknown) => log("info", m, meta),
  warn: (m: string, meta?: unknown) => log("warn", m, meta),
  error: (m: string, meta?: unknown) => log("error", m, meta),
  debug: (m: string, meta?: unknown) => log("debug", m, meta),
};
