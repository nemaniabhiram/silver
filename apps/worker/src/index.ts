import {
  createLogger,
  createPool,
  createStorageClient,
  loadConfig,
  runMigrations,
} from "@silver/shared";
import { claimNextQueuedDeployment } from "./claim.js";
import { expireOldDeployments } from "./cleanup.js";
import { runDeployment, type WorkerDependencies } from "./pipeline.js";
import { recoverStaleBuilds } from "./sweep.js";

const SWEEP_INTERVAL_MS = 60_000;
const CLEANUP_INTERVAL_MS = 60 * 60_000;

const config = loadConfig();
const log = createLogger("worker", config.LOG_FORMAT);
const pool = createPool(config, log);
const storage = createStorageClient(config);
const dependencies: WorkerDependencies = { config, pool, storage, log };

const applied = await runMigrations(pool);
if (applied.length > 0) {
  log.info("applied migrations", { migrations: applied.join(", ") });
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

log.info("polling", {
  intervalMs: config.POLL_INTERVAL_MS,
  maxConcurrentBuilds: config.MAX_CONCURRENT_BUILDS,
});

while (accepting) {
  if (inFlight.size >= config.MAX_CONCURRENT_BUILDS) {
    await Promise.race(inFlight);
    continue;
  }

  const deployment = await claimNextQueuedDeployment(pool).catch((error: unknown) => {
    log.error("could not reach the queue", error);
    return null;
  });

  if (!deployment) {
    await sleep(config.POLL_INTERVAL_MS);
    continue;
  }

  // Every line about this build carries its id from here down.
  const buildLog = log.child({ deploymentId: deployment.id });
  buildLog.info("building");

  // runDeployment records its own build failures, so a rejection here means the
  // recording failed too, most likely because the database went away. Swallowing
  // it keeps that from reaching Promise.race above and ending the poll loop.
  const build = runDeployment({ ...dependencies, log: buildLog }, deployment)
    .catch((error: unknown) => {
      buildLog.error("could not finish the build", error);
    })
    .finally(() => {
      inFlight.delete(build);
    });
  inFlight.add(build);
}

clearInterval(sweepTimer);
clearInterval(cleanupTimer);
await Promise.allSettled(inFlight);
await pool.end();
storage.destroy();
log.info("stopped");

async function sweep(): Promise<void> {
  try {
    const recovered = await recoverStaleBuilds(dependencies);
    if (recovered > 0) {
      log.info("recovered interrupted builds", { count: recovered });
    }
  } catch (error) {
    log.error("sweep failed", error);
  }
}

async function cleanup(): Promise<void> {
  try {
    const removed = await expireOldDeployments(dependencies);
    if (removed > 0) {
      log.info("expired deployments", { count: removed });
    }
  } catch (error) {
    log.error("cleanup failed", error);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
