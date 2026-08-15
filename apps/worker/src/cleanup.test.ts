import type { S3Client } from "@aws-sdk/client-s3";
import {
  createLogger,
  createPool,
  loadConfig,
  newDeploymentId,
  runMigrations,
} from "@silver/shared";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { expireOldDeployments } from "./cleanup.js";
import type { WorkerDependencies } from "./pipeline.js";

const config = loadConfig();
const log = createLogger("cleanup-test");
const pool = createPool(config, log);

// Resolved before the suite is registered, because skipIf is evaluated then. A
// flag set in beforeAll comes too late and the suite runs against nothing.
const reachable = await runMigrations(pool).then(
  () => true,
  () => false,
);

/** Storage is not what this suite is about, so nothing here talks to it. */
function storageThatDeletesNothing(): S3Client {
  return { send: () => Promise.resolve({ Contents: [] }) } as unknown as S3Client;
}

function dependencies(storage: S3Client): WorkerDependencies {
  return { config, pool, storage, log };
}

async function seedExpired(count: number, status: string): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await pool.query(
      `INSERT INTO deployments (id, status, source_key, source_size_bytes, expires_at)
       VALUES ($1, $2, $3, 1, now() - interval '1 day')`,
      [newDeploymentId(), status, `sources/${index}.zip`],
    );
  }
}

async function countByStatus(status: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    "SELECT count(*) FROM deployments WHERE status = $1",
    [status],
  );
  return Number(result.rows[0]?.count ?? 0);
}

describe.skipIf(!reachable)("expireOldDeployments", () => {
  beforeEach(async () => {
    await pool.query("TRUNCATE deployments CASCADE");
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await pool.end();
  });

  /**
   * The batch size is 100, so 250 rows only finish if the job keeps paging.
   * Before this it read the whole backlog into one array, which made the size
   * of a weekend outage the size of the heap.
   */
  it("drains a backlog larger than one batch", async () => {
    await seedExpired(250, "READY");

    const removed = await expireOldDeployments(dependencies(storageThatDeletesNothing()));

    expect(removed).toBe(250);
    expect(await countByStatus("EXPIRED")).toBe(250);
  }, 60_000);

  it("expires failed and cancelled deployments too, not only live ones", async () => {
    await seedExpired(2, "READY");
    await seedExpired(2, "FAILED");
    await seedExpired(2, "CANCELLED");

    expect(await expireOldDeployments(dependencies(storageThatDeletesNothing()))).toBe(6);
  });

  it("leaves deployments that have not reached their expiry alone", async () => {
    await pool.query(
      `INSERT INTO deployments (id, status, source_key, source_size_bytes, expires_at)
       VALUES ($1, 'READY', 'sources/live.zip', 1, now() + interval '1 day')`,
      [newDeploymentId()],
    );

    expect(await expireOldDeployments(dependencies(storageThatDeletesNothing()))).toBe(0);
    expect(await countByStatus("READY")).toBe(1);
  });

  /**
   * The reason the query walks a cursor rather than re-asking for matches: a
   * row that cannot be expired stays matching, so re-asking would hand back the
   * same full batch forever and the job would never return.
   */
  it("returns rather than spinning when every row in a full batch fails", async () => {
    await seedExpired(150, "READY");
    vi.spyOn(log, "error").mockImplementation(() => undefined);

    const storage = {
      send: () => Promise.reject(new Error("storage is down")),
    } as unknown as S3Client;

    const removed = await expireOldDeployments(dependencies(storage));

    expect(removed).toBe(0);
    expect(await countByStatus("READY")).toBe(150);
  }, 60_000);
});
