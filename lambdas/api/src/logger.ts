declare const process: {
  env: {
    LOG_LEVEL?: string;
  };
};

type Level = "debug" | "info" | "warn" | "error";

const REDACT_KEYS =
  /access_token|refresh_token|token|secret|key|authorization|password|signature|api[_-]?key/i;
const REDACT_HEADERS = /x-signature-ed25519|authorization|cookie|set-cookie/i;

const LOG_LEVELS: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const getMinLevel = (): number => {
  const configured = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return LOG_LEVELS[configured as Level] ?? LOG_LEVELS.info;
};

const redact = (obj: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT_KEYS.test(k) || REDACT_HEADERS.test(k)) {
      out[k] = "[REDACTED]";
    } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      out[k] = redact(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
};

const noop = () => {};

export interface Logger {
  debug: (msg: string, extra?: Record<string, unknown>) => void;
  info: (msg: string, extra?: Record<string, unknown>) => void;
  warn: (msg: string, extra?: Record<string, unknown>) => void;
  error: (msg: string, extra?: Record<string, unknown>) => void;
}

export const noopLogger: Logger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};

export const createLogger = (traceId: string): Logger => {
  const log = (level: Level, message: string, extra?: Record<string, unknown>) => {
    if (LOG_LEVELS[level] < getMinLevel()) return;
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      traceId,
      message,
    };
    if (extra) Object.assign(entry, redact(extra));
    const fn =
      level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    fn(JSON.stringify(entry));
  };

  return {
    debug: (msg, extra) => log("debug", msg, extra),
    info: (msg, extra) => log("info", msg, extra),
    warn: (msg, extra) => log("warn", msg, extra),
    error: (msg, extra) => log("error", msg, extra),
  };
};
