import { mapDeploymentRow, transitionDeployment } from "@silver/shared";
import type { WorkerDependencies } from "./pipeline.js";
import { announce } from "./logs.js";

const GRACE_SECONDS = 60;
const RETRY_BACKOFF_SECONDS = 30;

/**
 * A worker killed mid-build leaves its deployment stuck in BUILDING with nobody
 * working on it. Nothing else will ever notice, so on startup and periodically
 * the rows that have been building longer than any build could take are treated
 * as the crash leftovers they are.
 */
export async function recoverStaleBuilds({
  config,
  pool,
}: WorkerDependencies): Promise<number> {
  const staleAfterSeconds = config.BUILD_TIMEOUT_SECONDS + GRACE_SECONDS;

  const stale = await pool.query(
    `SELECT * FROM deployments
     WHERE status = 'BUILDING' AND started_at < now() - make_interval(secs => $1)`,
    [staleAfterSeconds],
  );

  let recovered = 0;

  for (const row of stale.rows) {
    const deployment = mapDeploymentRow(row);
    const canRetry = deployment.attemptCount < deployment.maxAttempts;

    if (canRetry) {
      const waitSeconds = RETRY_BACKOFF_SECONDS * deployment.attemptCount;
      const requeued = await transitionDeployment(pool, deployment.id, "BUILDING", "QUEUED", {
        started_at: null,
        available_at: new Date(Date.now() + waitSeconds * 1000),
      });

      if (requeued) {
        recovered += 1;
        await announce(pool, deployment.id, "Picking this up again after an interrupted build.");
      }
      continue;
    }

    const failed = await transitionDeployment(pool, deployment.id, "BUILDING", "FAILED", {
      error_message: "The build was interrupted and did not recover.",
      finished_at: new Date(),
    });

    if (failed) {
      recovered += 1;
      await announce(pool, deployment.id, "Giving up after repeated interrupted builds.");
    }
  }

  return recovered;
}
