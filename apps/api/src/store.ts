import { type Deployment, mapDeploymentRow } from "@silver/shared";
import type pg from "pg";

interface NewDeployment {
  id: string;
  sourceKey: string;
  sourceSizeBytes: number;
  requestedPreset: string | null;
  retentionDays: number;
}

export async function insertDeployment(
  pool: pg.Pool,
  deployment: NewDeployment,
): Promise<Deployment> {
  const result = await pool.query(
    `INSERT INTO deployments (id, source_key, source_size_bytes, requested_preset, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(days => $5))
     RETURNING *`,
    [
      deployment.id,
      deployment.sourceKey,
      deployment.sourceSizeBytes,
      deployment.requestedPreset,
      deployment.retentionDays,
    ],
  );

  return mapDeploymentRow(result.rows[0]);
}

export async function findDeployment(pool: pg.Pool, id: string): Promise<Deployment | null> {
  const result = await pool.query("SELECT * FROM deployments WHERE id = $1", [id]);
  const row = result.rows[0];
  return row ? mapDeploymentRow(row) : null;
}
