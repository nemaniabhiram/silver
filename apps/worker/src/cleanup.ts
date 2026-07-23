import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  type S3Client,
} from "@aws-sdk/client-s3";
import { mapDeploymentRow, sitePrefix, sourceKey, transitionDeployment } from "@silver/shared";
import type { WorkerDependencies } from "./pipeline.js";

const DELETE_BATCH = 1000;

/**
 * Anonymous deployments do not live forever. Expiry removes the files first and
 * marks the row afterwards, so a crash midway leaves a row still claiming to be
 * live over files that are gone rather than the reverse — and running the whole
 * job twice is harmless.
 *
 * This is also why retry and redeploy are illegal from EXPIRED: the source
 * archive they would need is deleted here.
 */
export async function expireOldDeployments(
  dependencies: WorkerDependencies,
): Promise<number> {
  const { pool } = dependencies;

  const expired = await pool.query(
    `SELECT * FROM deployments
     WHERE (status = 'READY' AND expires_at < now())
        OR (status IN ('FAILED','CANCELLED') AND expires_at < now())`,
  );

  let removed = 0;

  for (const row of expired.rows) {
    const deployment = mapDeploymentRow(row);

    try {
      await deleteDeploymentObjects(dependencies, deployment.id);
      const marked = await transitionDeployment(
        pool,
        deployment.id,
        ["READY", "FAILED", "CANCELLED"],
        "EXPIRED",
      );
      if (marked) {
        removed += 1;
      }
    } catch (error) {
      console.error(`[worker] could not expire ${deployment.id}`, error);
    }
  }

  return removed;
}

export async function deleteDeploymentObjects(
  { config, storage }: WorkerDependencies,
  deploymentId: string,
): Promise<void> {
  await deletePrefix(storage, config.S3_BUCKET, sitePrefix(deploymentId));
  await deleteKeys(storage, config.S3_BUCKET, [sourceKey(deploymentId)]);
}

async function deletePrefix(storage: S3Client, bucket: string, prefix: string): Promise<void> {
  let continuationToken: string | undefined;

  do {
    const listed = await storage.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: DELETE_BATCH,
      }),
    );

    const keys = (listed.Contents ?? [])
      .map((object) => object.Key)
      .filter((key): key is string => Boolean(key));

    await deleteKeys(storage, bucket, keys);
    continuationToken = listed.NextContinuationToken;
  } while (continuationToken);
}

async function deleteKeys(storage: S3Client, bucket: string, keys: string[]): Promise<void> {
  if (keys.length === 0) {
    return;
  }

  await storage.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: keys.map((Key) => ({ Key })) },
    }),
  );
}
