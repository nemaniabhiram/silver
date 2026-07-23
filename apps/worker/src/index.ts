import { createPool, createStorageClient, loadConfig, runMigrations } from "@silver/shared";
import { claimNextQueuedDeployment } from "./claim.js";
import { runDeployment, type WorkerDependencies } from "./pipeline.js";

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

await Promise.allSettled(inFlight);
await pool.end();
storage.destroy();
console.log("[worker] stopped");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
