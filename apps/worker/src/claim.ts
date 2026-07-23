import { type Deployment, mapDeploymentRow } from "@silver/shared";
import type pg from "pg";

/**
 * Claims one queued deployment as a single statement, so no two workers can
 * observe the same row as claimable. SKIP LOCKED lets a second worker step over
 * a row another is already taking rather than blocking behind it.
 */
export async function claimNextQueuedDeployment(pool: pg.Pool): Promise<Deployment | null> {
  const result = await pool.query(
    `UPDATE deployments
     SET status = 'BUILDING', started_at = now(), attempt_count = attempt_count + 1
     WHERE id = (
       SELECT id FROM deployments
       WHERE status = 'QUEUED' AND available_at <= now()
       ORDER BY created_at
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
  );

  const row = result.rows[0];
  return row ? mapDeploymentRow(row) : null;
}
