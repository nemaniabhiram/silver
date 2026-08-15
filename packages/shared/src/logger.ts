export type LogFields = Record<string, string | number | boolean | null | undefined>;

export type LogFormat = "pretty" | "json";

export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, cause?: unknown, fields?: LogFields): void;
  /** A logger that stamps these fields on every line it and its children emit. */
  child(fields: LogFields): Logger;
}

type Level = "info" | "warn" | "error";

/**
 * One line per event, carrying the service that wrote it and whatever a caller
 * has stamped on the way down. A deployment id set once by the worker rides
 * every line about that build, which is what makes a failure greppable across
 * three services that never speak to each other.
 *
 * Pretty is for a terminal, json is for anything that parses logs. Errors keep
 * their stack in both: in json as a field, in pretty by handing the object to
 * console.error, which renders it the way Node already does.
 */
export function createLogger(service: string, format: LogFormat = "pretty"): Logger {
  return build(service, format, {});
}

function build(service: string, format: LogFormat, inherited: LogFields): Logger {
  function emit(level: Level, message: string, fields: LogFields, cause?: unknown): void {
    const merged = { ...inherited, ...fields };

    if (format === "json") {
      console[level === "error" ? "error" : "log"](
        JSON.stringify({
          ts: new Date().toISOString(),
          level,
          service,
          msg: message,
          ...merged,
          ...describe(cause),
        }),
      );
      return;
    }

    const line = asText(service, message, merged);
    if (level === "error") {
      // Handing the cause to console.error rather than flattening it keeps the
      // stack Node already renders, which is the whole value of it in a terminal.
      if (cause === undefined) {
        console.error(line);
      } else {
        console.error(line, cause);
      }
      return;
    }
    console.log(line);
  }

  return {
    info: (message, fields = {}) => emit("info", message, fields),
    warn: (message, fields = {}) => emit("warn", message, fields),
    error: (message, cause, fields = {}) => emit("error", message, fields, cause),
    child: (fields) => build(service, format, { ...inherited, ...fields }),
  };
}

function describe(cause: unknown): LogFields {
  if (cause === undefined) {
    return {};
  }
  if (cause instanceof Error) {
    return { err: cause.message, stack: cause.stack };
  }
  return { err: render(cause) };
}

/**
 * Anything at all can be thrown, and none of it is guaranteed to stringify into
 * something worth reading. An object goes through JSON, which says more than
 * [object Object]; a circular or unserialisable one falls back to its type,
 * which is at least true.
 */
function render(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  try {
    return JSON.stringify(value) ?? typeof value;
  } catch {
    return typeof value;
  }
}

function asText(service: string, message: string, fields: LogFields): string {
  const rendered = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");

  return rendered ? `[${service}] ${message} ${rendered}` : `[${service}] ${message}`;
}
