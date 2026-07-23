import { createReadStream } from "node:fs";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { isDeploymentId, newDeploymentId, sourceKey } from "@silver/shared";
import { type RequestHandler, Router } from "express";
import { MulterError } from "multer";
import { z } from "zod";
import type { Dependencies } from "../dependencies.js";
import { ApiError } from "../errors.js";
import type { RateLimiter } from "../rate-limit.js";
import { rateLimit } from "../rate-limit.js";
import { toDeploymentResource } from "../resource.js";
import { findDeployment, insertDeployment } from "../store.js";
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
    const id = request.params.id;
    if (typeof id !== "string" || !isDeploymentId(id)) {
      throw new ApiError("NOT_FOUND", "This deployment doesn't exist — it may have expired.");
    }

    const deployment = await findDeployment(pool, id);
    if (!deployment) {
      throw new ApiError("NOT_FOUND", "This deployment doesn't exist — it may have expired.");
    }

    response.json(toDeploymentResource(deployment, config));
  });

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
