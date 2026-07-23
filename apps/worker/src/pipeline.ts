import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import {
  type Config,
  type Deployment,
  deploymentUrl,
  sourceKey,
  transitionDeployment,
} from "@silver/shared";
import type pg from "pg";
import { extractZip } from "./extract.js";
import { BuildFailure } from "./failure.js";
import { announce } from "./logs.js";
import {
  assertDeployable,
  assertWithin,
  collectSiteFiles,
  uploadSite,
} from "./output.js";
import { selectPreset } from "./presets.js";

export interface WorkerDependencies {
  config: Config;
  pool: pg.Pool;
  storage: S3Client;
}

export async function runDeployment(
  dependencies: WorkerDependencies,
  deployment: Deployment,
): Promise<void> {
  const { config, pool, storage } = dependencies;
  const workspace = path.join(tmpdir(), "silver-builds", deployment.id);
  const startedAt = Date.now();

  try {
    await mkdir(workspace, { recursive: true });
    await announce(pool, deployment.id, "Unpacking your files…");

    const zipPath = path.join(workspace, "source.zip");
    await downloadSource(storage, config.S3_BUCKET, deployment.id, zipPath);

    const rootDir = await extractZip(
      zipPath,
      path.join(workspace, "src"),
      config.MAX_UPLOAD_MB * 4 * 1024 * 1024,
    );

    const preset = await selectPreset(rootDir, deployment.requestedPreset);
    await announce(pool, deployment.id, `Detected a ${preset.name} site.`);

    const outputDir = await preset.resolveOutputDir(rootDir);
    assertWithin(rootDir, outputDir);

    const files = await collectSiteFiles(outputDir);
    assertDeployable(files, config.MAX_OUTPUT_MB * 1024 * 1024);

    await announce(pool, deployment.id, `Uploading ${files.length} files…`);
    const site = await uploadSite(storage, config.S3_BUCKET, deployment.id, files);

    await transitionDeployment(pool, deployment.id, "BUILDING", "READY", {
      detected_preset: preset.name,
      output_size_bytes: site.sizeBytes,
      output_file_count: site.fileCount,
      artifact_checksum: site.checksum,
      finished_at: new Date(),
      build_duration_ms: Date.now() - startedAt,
      error_message: null,
    });

    await announce(pool, deployment.id, `Deployed to ${deploymentUrl(deployment.id, config)}`);
  } catch (error) {
    await recordFailure(dependencies, deployment, error, startedAt);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function recordFailure(
  { pool }: WorkerDependencies,
  deployment: Deployment,
  error: unknown,
  startedAt: number,
): Promise<void> {
  const reason = error instanceof Error ? error.message : String(error);

  if (error instanceof BuildFailure) {
    await announce(pool, deployment.id, `Failed: ${reason}`);
    await transitionDeployment(pool, deployment.id, "BUILDING", "FAILED", {
      error_message: reason,
      finished_at: new Date(),
      build_duration_ms: Date.now() - startedAt,
    });
    return;
  }

  const canRetry = deployment.attemptCount < deployment.maxAttempts;
  console.error(`[worker] system error on ${deployment.id}`, error);

  if (canRetry) {
    await announce(
      pool,
      deployment.id,
      `System error, retrying (attempt ${deployment.attemptCount + 1}/${deployment.maxAttempts}): ${reason}`,
    );
    await transitionDeployment(pool, deployment.id, "BUILDING", "QUEUED", {
      error_message: reason,
      started_at: null,
    });
    return;
  }

  await announce(pool, deployment.id, `Giving up after repeated system errors: ${reason}`);
  await transitionDeployment(pool, deployment.id, "BUILDING", "FAILED", {
    error_message: `Repeated system errors: ${reason}`,
    finished_at: new Date(),
    build_duration_ms: Date.now() - startedAt,
  });
}

async function downloadSource(
  storage: S3Client,
  bucket: string,
  deploymentId: string,
  destPath: string,
): Promise<void> {
  const object = await storage.send(
    new GetObjectCommand({ Bucket: bucket, Key: sourceKey(deploymentId) }),
  );

  if (!object.Body) {
    throw new Error(`Source archive for ${deploymentId} is empty.`);
  }

  await pipeline(object.Body as NodeJS.ReadableStream, createWriteStream(destPath));
}
