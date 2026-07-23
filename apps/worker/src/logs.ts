import type pg from "pg";

export const PLATFORM_PREFIX = "[silver]";

export async function appendDeploymentLogs(
  pool: pg.Pool,
  deploymentId: string,
  messages: string[],
): Promise<void> {
  if (messages.length === 0) {
    return;
  }

  await pool.query(
    `INSERT INTO deployment_logs (deployment_id, message)
     SELECT $1, * FROM unnest($2::text[])`,
    [deploymentId, messages],
  );
}

export function announce(pool: pg.Pool, deploymentId: string, message: string): Promise<void> {
  return appendDeploymentLogs(pool, deploymentId, [`${PLATFORM_PREFIX} ${message}`]);
}
