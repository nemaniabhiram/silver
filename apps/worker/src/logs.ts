import type pg from "pg";

export const PLATFORM_PREFIX = "[silver]";

const FLUSH_AFTER_LINES = 50;
const FLUSH_AFTER_MS = 500;
const MAX_LOG_BYTES = 1024 * 1024;

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

export interface LogWriter {
  write(line: string): void;
  close(): Promise<void>;
}

/**
 * Collects build output and writes it in batches, so a chatty build costs a
 * handful of inserts rather than one per line. A build that will not stop
 * talking is cut off at a fixed budget — the logs exist to explain a failure,
 * and past a point more of them explain less.
 */
export function createLogWriter(
  pool: pg.Pool,
  deploymentId: string,
  maxBytes: number = MAX_LOG_BYTES,
): LogWriter {
  let buffered: string[] = [];
  let bytesAccepted = 0;
  let truncated = false;
  let timer: NodeJS.Timeout | null = null;
  let writes: Promise<void> = Promise.resolve();

  function flush(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    if (buffered.length === 0) {
      return;
    }

    const batch = buffered;
    buffered = [];
    writes = writes.then(() =>
      appendDeploymentLogs(pool, deploymentId, batch).catch((error: unknown) => {
        console.error(`[worker] could not persist logs for ${deploymentId}`, error);
      }),
    );
  }

  return {
    write(line) {
      if (truncated) {
        return;
      }

      bytesAccepted += Buffer.byteLength(line, "utf8") + 1;
      if (bytesAccepted > maxBytes) {
        truncated = true;
        buffered.push(`${PLATFORM_PREFIX} log truncated`);
        flush();
        return;
      }

      buffered.push(line);

      if (buffered.length >= FLUSH_AFTER_LINES) {
        flush();
        return;
      }

      timer ??= setTimeout(flush, FLUSH_AFTER_MS);
    },

    async close() {
      flush();
      await writes;
    },
  };
}
