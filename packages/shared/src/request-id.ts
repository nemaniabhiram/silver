import { randomUUID } from "node:crypto";
import type { RequestHandler, Response } from "express";
import type { Logger } from "./logger.js";

/**
 * Gives every request an id, echoes it to the caller, and leaves a logger
 * stamped with it on the response. A user who reports a failure can read the
 * id off the response headers, which is the only way to find their one request
 * in a log holding everyone else's.
 *
 * An id arriving from a proxy is kept rather than replaced, so a trace that
 * started upstream stays one trace.
 */
export function requestId(base: Logger): RequestHandler {
  return (request, response, next) => {
    const inbound = request.header("x-request-id");
    const id = inbound && inbound.length <= 200 ? inbound : randomUUID();

    response.setHeader("X-Request-Id", id);
    response.locals["log"] = base.child({ requestId: id });
    next();
  };
}

/** The request's logger, or the service's own when the middleware has not run. */
export function loggerFor(response: Response, fallback: Logger): Logger {
  const attached: unknown = response.locals["log"];
  return isLogger(attached) ? attached : fallback;
}

function isLogger(value: unknown): value is Logger {
  return typeof value === "object" && value !== null && "child" in value;
}
