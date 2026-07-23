import { createPool, createStorageClient, loadConfig, runMigrations } from "@silver/shared";
import { claimNextQueuedDeployment } from "./claim.js";
import { expireOldDeployments } from "./cleanup.js";
import { runDeployment, type WorkerDependencies } from "./pipeline.js";
import { recoverStaleBuilds } from "./sweep.js";

const SWEEP_INTERVAL_MS = 60_000;
const CLEANUP_INTERVAL_MS = 60 * 60_000;

const config = loadConfig();
const pool = createPool(config);
const storage = createStorageClient(config);
const dependencies: WorkerDependencies = { config, pool, storage };

const applied = await runMigrations(pool);
if (applied.length > 0) {
  console.log(`[worker] applied migrations: ${applied.join(", ")}`);
}

let accepting = true;
const inFlight = new Set<Promise<void>>();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    accepting = false;
  });
}

// Both run once at startup: a worker that has been down may be returning to a
// backlog of interrupted builds and deployments that outlived their retention.
await sweep();
await cleanup();

const sweepTimer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);
const cleanupTimer = setInterval(() => void cleanup(), CLEANUP_INTERVAL_MS);

console.log(
  `[worker] polling every ${config.POLL_INTERVAL_MS}ms, up to ${config.MAX_CONCURRENT_BUILDS} at a time`,
);

while (accepting) {
  if (inFlight.size >= config.MAX_CONCURRENT_BUILDS) {
    await Promise.race(inFlight);
    continue;
  }

  const deployment = await claimNextQueuedDeployment(pool).catch((error: unknown) => {
    console.error("[worker] could not reach the queue", error);
    return null;
  });

  if (!deployment) {
    await sleep(config.POLL_INTERVAL_MS);
    continue;
  }

  console.log(`[worker] building ${deployment.id}`);
  const build = runDeployment(dependencies, deployment).finally(() => {
    inFlight.delete(build);
  });
  inFlight.add(build);
}

clearInterval(sweepTimer);
clearInterval(cleanupTimer);
await Promise.allSettled(inFlight);
await pool.end();
storage.destroy();
console.log("[worker] stopped");

async function sweep(): Promise<void> {
  try {
    const recovered = await recoverStaleBuilds(dependencies);
    if (recovered > 0) {
      console.log(`[worker] recovered ${recovered} interrupted build(s)`);
    }
  } catch (error) {
    console.error("[worker] sweep failed", error);
  }
}

async function cleanup(): Promise<void> {
  try {
    const removed = await expireOldDeployments(dependencies);
    if (removed > 0) {
      console.log(`[worker] expired ${removed} deployment(s)`);
    }
  } catch (error) {
    console.error("[worker] cleanup failed", error);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
