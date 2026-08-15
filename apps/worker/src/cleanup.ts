import { DeleteObjectsCommand, ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import {
  type DeploymentRow,
  mapDeploymentRow,
  sitePrefix,
  sourceKey,
  transitionDeployment,
} from "@silver/shared";
import type { WorkerDependencies } from "./pipeline.js";

const DELETE_BATCH = 1000;
const EXPIRE_BATCH = 100;

const EXPIRABLE = ["READY", "FAILED", "CANCELLED"] as const;

/**
 * Anonymous deployments do not live forever. Expiry removes the files first and
 * marks the row afterwards, so a crash midway leaves a row still claiming to be
 * live over files that are gone rather than the reverse. Running the whole job
 * twice is harmless.
 *
 * This is also why retry and redeploy are illegal from EXPIRED: the source
 * archive they would need is deleted here.
 *
 * Work is taken a batch at a time. A worker that has been down for a weekend
 * comes back to a backlog of unknown size, and reading all of it into one array
 * makes the size of that backlog the size of the heap.
 */
export async function expireOldDeployments(dependencies: WorkerDependencies): Promise<number> {
  const { pool } = dependencies;
  let removed = 0;

  await forgetSpentRateLimits(dependencies);

  // The cursor is what makes this terminate. An expired row leaves the result
  // set once it is marked, but a row that failed to expire does not, so paging
  // by "the next batch of matches" would hand back the same failures forever if
  // storage were down. Walking a strictly increasing key skips them instead,
  // and the next hourly run picks them up.
  let after: { expiresAt: Date; id: string } = { expiresAt: new Date(0), id: "" };

  for (;;) {
    const expired = await pool.query<DeploymentRow>(
      `SELECT * FROM deployments
       WHERE status = ANY($1)
         AND expires_at < now()
         AND (expires_at, id) > ($2, $3)
       ORDER BY expires_at, id
       LIMIT $4`,
      [EXPIRABLE, after.expiresAt, after.id, EXPIRE_BATCH],
    );

    for (const row of expired.rows) {
      const deployment = mapDeploymentRow(row);

      try {
        await deleteDeploymentObjects(dependencies, deployment.id);
        const marked = await transitionDeployment(pool, deployment.id, [...EXPIRABLE], "EXPIRED");
        if (marked) {
          removed += 1;
        }
      } catch (error) {
        dependencies.log.error("could not expire deployment", error, {
          deploymentId: deployment.id,
        });
      }
    }

    const last = expired.rows.at(-1);
    if (!last || expired.rows.length < EXPIRE_BATCH) {
      return removed;
    }

    after = { expiresAt: last.expires_at, id: last.id };
  }
}

/**
 * Rate limit rows outlive their window and nothing else would ever remove them,
 * so an address seen once would be remembered forever. The longest window is an
 * hour; anything twice that old cannot affect a verdict.
 */
async function forgetSpentRateLimits({ pool, log }: WorkerDependencies): Promise<void> {
  try {
    await pool.query(
      "DELETE FROM rate_limits WHERE window_started_at < now() - interval '2 hours'",
    );
  } catch (error) {
    log.error("could not clear spent rate limits", error);
  }
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
