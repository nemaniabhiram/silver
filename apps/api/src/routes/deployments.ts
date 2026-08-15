import { createReadStream } from "node:fs";
import { CopyObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  type Deployment,
  isDeploymentId,
  newDeploymentId,
  sourceKey,
  transitionDeployment,
} from "@silver/shared";
import { type RequestHandler, Router } from "express";
import { MulterError } from "multer";
import { z } from "zod";
import type { Dependencies } from "../dependencies.js";
import type { DeploymentEvents } from "../events.js";
import { ApiError } from "../errors.js";
import { type RateLimiter, rateLimit, tooFast } from "../rate-limit.js";
import { toDeploymentResource } from "../resource.js";
import { findDeployment, insertDeployment, readDeploymentLogs } from "../store.js";
import { createUploadMiddleware, discard, looksLikeZip } from "../upload.js";

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** A stream is not a request, so it is admitted by how many are already open. */
const MAX_STREAMS_PER_IP = 5;
const HEARTBEAT_MS = 20_000;

const PresetOverride = z.enum(["static", "vite", "cra", "npm"]).optional();

export function createDeploymentsRouter(
  dependencies: Dependencies,
  limiter: RateLimiter,
  events: DeploymentEvents,
): Router {
  const { config, pool, storage } = dependencies;
  const router = Router();

  const limitAttempts = rateLimit(
    limiter,
    "attempts",
    config.RATE_LIMIT_ATTEMPTS_PER_HOUR,
    HOUR_MS,
  );
  const limitWrites = rateLimit(limiter, "deploys", config.RATE_LIMIT_DEPLOYS_PER_HOUR, HOUR_MS);
  const limitReads = rateLimit(limiter, "reads", config.RATE_LIMIT_READS_PER_MINUTE, MINUTE_MS);

  /**
   * Quota is spent on deployments created, not on attempts made. Fumbling a
   * few uploads should not lock someone out for an hour. Flooding is bounded
   * separately by the attempt ceiling, and the quota is checked before the file
   * is read so an over-quota caller is turned away without doing the work.
   */
  router.post("/", limitAttempts, acceptUpload(config), async (request, response) => {
    const quotaKey = `deploys:${request.ip}`;
    const quota = await limiter.peek(quotaKey, config.RATE_LIMIT_DEPLOYS_PER_HOUR, HOUR_MS);
    if (!quota.allowed) {
      await discard(request.file?.path);
      throw tooFast(quota.retryAfterSeconds);
    }

    const file = request.file;
    if (!file) {
      throw new ApiError("INVALID_UPLOAD", "Attach a .zip file in the 'file' field.");
    }

    try {
      if (!(await looksLikeZip(file.path))) {
        throw new ApiError("INVALID_UPLOAD", "That file isn't a zip archive.");
      }

      const fields = request.body as Record<string, unknown> | undefined;
      const preset = PresetOverride.safeParse(fields?.["preset"] || undefined);
      if (!preset.success) {
        throw new ApiError("INVALID_UPLOAD", "Preset must be one of: static, vite, cra, npm.");
      }

      const id = newDeploymentId();
      const key = sourceKey(id);

      await storage.send(
        new PutObjectCommand({
          Bucket: config.S3_BUCKET,
          Key: key,
          Body: createReadStream(file.path),
          ContentLength: file.size,
          ContentType: "application/zip",
        }),
      );

      const deployment = await insertDeployment(pool, {
        id,
        sourceKey: key,
        sourceSizeBytes: file.size,
        requestedPreset: preset.data ?? null,
        retentionDays: config.RETENTION_DAYS,
      });

      await limiter.consume(quotaKey, config.RATE_LIMIT_DEPLOYS_PER_HOUR, HOUR_MS);
      response.status(201).json(toDeploymentResource(deployment, config));
    } finally {
      await discard(file.path);
    }
  });

  router.get("/:id", limitReads, async (request, response) => {
    response.json(toDeploymentResource(await requireDeployment(request.params.id), config));
  });

  router.get("/:id/logs", limitReads, async (request, response) => {
    const deployment = await requireDeployment(request.params.id);
    const afterId = Number(request.query.afterId ?? 0);

    const logs = await readDeploymentLogs(
      pool,
      deployment.id,
      Number.isFinite(afterId) && afterId > 0 ? afterId : 0,
    );

    response.json({ logs, lastId: Number(logs.at(-1)?.id ?? afterId) || 0 });
  });

  /**
   * The same log lines and status changes the polling endpoints above serve,
   * pushed as they land instead of asked for every two seconds.
   *
   * A notification is only a doorbell: every wake re-reads from the cursor, so
   * the first send, a live update and a resume after a dropped connection are
   * all the same path. The event id is the log row's own id, which is what lets
   * the browser hand back Last-Event-ID and carry on exactly where it stopped.
   */
  router.get("/:id/events", async (request, response) => {
    const deployment = await requireDeployment(request.params.id);
    const ip = request.ip ?? "";

    if (events.streamsFrom(ip) >= MAX_STREAMS_PER_IP) {
      throw new ApiError("RATE_LIMITED", "Too many open log streams. Close one and try again.");
    }

    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
    // Proxies buffer by default, which holds the whole stream until the build
    // ends and looks exactly like the feature not working.
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();

    let cursor = startingCursor(request);
    let lastStatus = "";
    let sending = false;
    let again = false;

    async function send(): Promise<void> {
      // Notifications can arrive faster than a read completes. Rather than
      // overlap them, the one in flight is asked to go round again.
      if (sending) {
        again = true;
        return;
      }

      sending = true;
      try {
        do {
          again = false;

          const logs = await readDeploymentLogs(pool, deployment.id, cursor);
          for (const line of logs) {
            cursor = Number(line.id);
            response.write(`id: ${line.id}\nevent: log\ndata: ${JSON.stringify(line)}\n\n`);
          }

          const current = await findDeployment(pool, deployment.id);
          if (current && current.status !== lastStatus) {
            lastStatus = current.status;
            // No id on a status event: the browser stores the last id it saw as
            // its resume point, and a non-log id there would corrupt it.
            response.write(
              `event: status\ndata: ${JSON.stringify(toDeploymentResource(current, config))}\n\n`,
            );
          }
        } while (again);
      } finally {
        sending = false;
      }
    }

    await send();

    const unsubscribe = events.subscribe(deployment.id, ip, () => {
      void send().catch(() => undefined);
    });

    // Intermediaries close a connection that has said nothing for long enough.
    const heartbeat = setInterval(() => response.write(": ping\n\n"), HEARTBEAT_MS);

    request.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  router.post("/:id/retry", limitWrites, async (request, response) => {
    const deployment = await requireDeployment(request.params.id);

    const retried = await transitionDeployment(
      pool,
      deployment.id,
      ["FAILED", "CANCELLED"],
      "QUEUED",
      { attempt_count: 0, error_message: null, started_at: null, available_at: new Date() },
    );

    if (!retried) {
      throw new ApiError("INVALID_STATE", "Only a failed or cancelled deployment can be retried.");
    }

    response.json(toDeploymentResource(retried, config));
  });

  router.post("/:id/cancel", limitReads, async (request, response) => {
    const deployment = await requireDeployment(request.params.id);

    const cancelled = await transitionDeployment(pool, deployment.id, "QUEUED", "CANCELLED", {
      finished_at: new Date(),
    });

    if (!cancelled) {
      throw new ApiError(
        "INVALID_STATE",
        "Only a deployment that hasn't started building can be cancelled.",
      );
    }

    response.json(toDeploymentResource(cancelled, config));
  });

  router.post("/:id/redeploy", limitWrites, async (request, response) => {
    const source = await requireDeployment(request.params.id);

    if (source.status === "EXPIRED") {
      throw new ApiError("INVALID_STATE", "This deployment expired, so its files are gone.");
    }
    if (source.status === "QUEUED" || source.status === "BUILDING") {
      throw new ApiError("INVALID_STATE", "This deployment is still running.");
    }

    const id = newDeploymentId();
    await storage.send(
      new CopyObjectCommand({
        Bucket: config.S3_BUCKET,
        CopySource: `${config.S3_BUCKET}/${source.sourceKey}`,
        Key: sourceKey(id),
      }),
    );

    const copy = await insertDeployment(pool, {
      id,
      sourceKey: sourceKey(id),
      sourceSizeBytes: source.sourceSizeBytes,
      requestedPreset: source.requestedPreset,
      retentionDays: config.RETENTION_DAYS,
    });

    response.status(201).json(toDeploymentResource(copy, config));
  });

  async function requireDeployment(rawId: unknown): Promise<Deployment> {
    const id = typeof rawId === "string" ? rawId : "";
    const deployment = isDeploymentId(id) ? await findDeployment(pool, id) : null;

    if (!deployment) {
      throw new ApiError("NOT_FOUND", "This deployment doesn't exist. It may have expired.");
    }

    return deployment;
  }

  return router;
}

/**
 * Where to resume from. The browser resends Last-Event-ID on its own
 * reconnects; a fresh page load has no header and says so in the query instead.
 */
function startingCursor(request: {
  header(name: string): string | undefined;
  query: unknown;
}): number {
  const resumed = Number(request.header("last-event-id"));
  if (Number.isInteger(resumed) && resumed > 0) {
    return resumed;
  }

  const asked = Number((request.query as { afterId?: unknown } | undefined)?.afterId ?? 0);
  return Number.isInteger(asked) && asked > 0 ? asked : 0;
}

/** Translates multer's own failures into the API's error envelope. */
function acceptUpload(config: Dependencies["config"]): RequestHandler {
  const upload = createUploadMiddleware(config);

  return (request, response, next) => {
    upload(request, response, (error: unknown) => {
      if (error instanceof MulterError) {
        next(
          error.code === "LIMIT_FILE_SIZE"
            ? new ApiError("UPLOAD_TOO_LARGE", `Zip exceeds the ${config.MAX_UPLOAD_MB} MB limit.`)
            : new ApiError("INVALID_UPLOAD", "That upload couldn't be read."),
        );
        return;
      }
      next(error);
    });
  };
}
