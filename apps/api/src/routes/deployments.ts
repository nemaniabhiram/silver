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
import { ApiError } from "../errors.js";
import type { RateLimiter } from "../rate-limit.js";
import { rateLimit } from "../rate-limit.js";
import { toDeploymentResource } from "../resource.js";
import { findDeployment, insertDeployment, readDeploymentLogs } from "../store.js";
import { createUploadMiddleware, discard, looksLikeZip } from "../upload.js";

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const PresetOverride = z.enum(["static", "vite", "cra", "npm"]).optional();

export function createDeploymentsRouter(
  dependencies: Dependencies,
  limiter: RateLimiter,
): Router {
  const { config, pool, storage } = dependencies;
  const router = Router();

  const limitWrites = rateLimit(
    limiter,
    "deploys",
    config.RATE_LIMIT_DEPLOYS_PER_HOUR,
    HOUR_MS,
  );
  const limitReads = rateLimit(
    limiter,
    "reads",
    config.RATE_LIMIT_READS_PER_MINUTE,
    MINUTE_MS,
  );

  router.post("/", limitWrites, acceptUpload(config), async (request, response) => {
    const file = request.file;
    if (!file) {
      throw new ApiError("INVALID_UPLOAD", "Attach a .zip file in the 'file' field.");
    }

    try {
      if (!(await looksLikeZip(file.path))) {
        throw new ApiError("INVALID_UPLOAD", "That file isn't a zip archive.");
      }

      const preset = PresetOverride.safeParse(request.body?.preset || undefined);
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
      throw new ApiError(
        "INVALID_STATE",
        "Only a failed or cancelled deployment can be retried.",
      );
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
      throw new ApiError("INVALID_STATE", "This deployment expired — its files are gone.");
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
      throw new ApiError("NOT_FOUND", "This deployment doesn't exist — it may have expired.");
    }

    return deployment;
  }

  return router;
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
