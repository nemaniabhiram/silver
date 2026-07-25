import { type Deployment, type DeploymentRow, mapDeploymentRow } from "@silver/shared";
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
  const result = await pool.query<DeploymentRow>(
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

  const row = result.rows[0];
  if (!row) {
    throw new Error("INSERT ... RETURNING produced no row");
  }

  return mapDeploymentRow(row);
}

export async function findDeployment(pool: pg.Pool, id: string): Promise<Deployment | null> {
  const result = await pool.query<DeploymentRow>("SELECT * FROM deployments WHERE id = $1", [id]);
  const row = result.rows[0];
  return row ? mapDeploymentRow(row) : null;
}

export interface LogEntry {
  id: string;
  message: string;
  createdAt: string;
}

export async function readDeploymentLogs(
  pool: pg.Pool,
  deploymentId: string,
  afterId: number,
): Promise<LogEntry[]> {
  const result = await pool.query<{ id: string; message: string; created_at: Date }>(
    `SELECT id, message, created_at FROM deployment_logs
     WHERE deployment_id = $1 AND id > $2
     ORDER BY id
     LIMIT 2000`,
    [deploymentId, afterId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    message: row.message,
    createdAt: row.created_at.toISOString(),
  }));
}
