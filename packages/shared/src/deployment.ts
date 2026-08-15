import type { Pool, PoolClient } from "pg";
import type { Config } from "./config.js";

export const DEPLOYMENT_STATUSES = [
  "QUEUED",
  "BUILDING",
  "READY",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const;

export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

export const VALID_TRANSITIONS: Record<DeploymentStatus, readonly DeploymentStatus[]> = {
  QUEUED: ["BUILDING", "CANCELLED"],
  BUILDING: ["READY", "FAILED", "QUEUED"],
  READY: ["EXPIRED"],
  FAILED: ["QUEUED", "EXPIRED"],
  CANCELLED: ["QUEUED", "EXPIRED"],
  EXPIRED: [],
};

export function canTransition(from: DeploymentStatus, to: DeploymentStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export interface Deployment {
  id: string;
  status: DeploymentStatus;
  requestedPreset: string | null;
  detectedPreset: string | null;
  sourceKey: string;
  sourceSizeBytes: number;
  outputSizeBytes: number | null;
  outputFileCount: number | null;
  artifactChecksum: string | null;
  attemptCount: number;
  maxAttempts: number;
  errorMessage: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  buildDurationMs: number | null;
  expiresAt: Date;
}

export interface DeploymentRow {
  id: string;
  status: DeploymentStatus;
  requested_preset: string | null;
  detected_preset: string | null;
  source_key: string;
  source_size_bytes: string;
  output_size_bytes: string | null;
  output_file_count: number | null;
  artifact_checksum: string | null;
  attempt_count: number;
  max_attempts: number;
  error_message: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  build_duration_ms: number | null;
  expires_at: Date;
}

export function mapDeploymentRow(row: DeploymentRow): Deployment {
  return {
    id: row.id,
    status: row.status,
    requestedPreset: row.requested_preset,
    detectedPreset: row.detected_preset,
    sourceKey: row.source_key,
    sourceSizeBytes: Number(row.source_size_bytes),
    outputSizeBytes: row.output_size_bytes === null ? null : Number(row.output_size_bytes),
    outputFileCount: row.output_file_count,
    artifactChecksum: row.artifact_checksum,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    buildDurationMs: row.build_duration_ms,
    expiresAt: row.expires_at,
  };
}

export function deploymentUrl(id: string, config: Config): string {
  return `${config.DEPLOY_PROTOCOL}://${id}.${config.DEPLOY_DOMAIN}`;
}

/**
 * Column names cannot be parameterised, so these are the only strings allowed
 * anywhere near the UPDATE below. The type keeps callers honest at compile time
 * and the array keeps them honest at runtime, where the type is gone.
 */
const WRITABLE_COLUMNS = [
  "detected_preset",
  "output_size_bytes",
  "output_file_count",
  "artifact_checksum",
  "attempt_count",
  "error_message",
  "started_at",
  "finished_at",
  "build_duration_ms",
  "available_at",
] as const;

type WritableColumn = (typeof WRITABLE_COLUMNS)[number];

export type TransitionColumns = Partial<Record<WritableColumn, unknown>>;

function isWritableColumn(column: string): column is WritableColumn {
  return (WRITABLE_COLUMNS as readonly string[]).includes(column);
}

type Executor = Pool | PoolClient;

/**
 * One channel for the whole system, carrying a deployment id as its payload.
 * A channel per deployment would mean issuing LISTEN and UNLISTEN as viewers
 * come and go, and channel names are SQL identifiers, so per-id channels would
 * mean building identifiers out of values. One fixed name avoids both, and an
 * id is far inside the 8000 byte payload limit.
 */
export const DEPLOYMENT_EVENTS_CHANNEL = "deployment_events";

/**
 * Wakes anything watching this deployment. Sent inside whatever transaction the
 * caller is in, so Postgres holds it until commit: a listener can never be told
 * about a row it cannot yet read.
 */
export async function notifyDeploymentChanged(
  executor: Executor,
  deploymentId: string,
): Promise<void> {
  await executor.query("SELECT pg_notify($1, $2)", [DEPLOYMENT_EVENTS_CHANNEL, deploymentId]);
}

/**
 * The only sanctioned way to change a deployment's status. Returns null when the
 * row has left `from` already, which callers read as a lost race: a conflict in
 * the api, something to skip in the worker.
 *
 * `from` may name several states for actions that are legal from more than one,
 * such as retrying a deployment that either failed or was cancelled.
 */
export async function transitionDeployment(
  executor: Executor,
  id: string,
  from: DeploymentStatus | DeploymentStatus[],
  to: DeploymentStatus,
  columns: TransitionColumns = {},
): Promise<Deployment | null> {
  const allowedFrom = Array.isArray(from) ? from : [from];

  for (const status of allowedFrom) {
    if (!canTransition(status, to)) {
      throw new Error(`Illegal deployment transition ${status} -> ${to}`);
    }
  }

  const assignments = ["status = $3"];
  const values: unknown[] = [id, allowedFrom, to];
  for (const [column, value] of Object.entries(columns)) {
    if (!isWritableColumn(column)) {
      throw new Error(`Refusing to write unknown deployment column "${column}"`);
    }

    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  }

  const result = await executor.query<DeploymentRow>(
    `UPDATE deployments SET ${assignments.join(", ")} WHERE id = $1 AND status = ANY($2) RETURNING *`,
    values,
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  // Every status change in the system passes through here, so this is the one
  // place that has to announce them.
  await notifyDeploymentChanged(executor, id);

  return mapDeploymentRow(row);
}
