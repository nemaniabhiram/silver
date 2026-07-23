import { createPool, createStorageClient, loadConfig, runMigrations } from "@silver/shared";

const config = loadConfig();
const pool = createPool(config);
const storage = createStorageClient(config);

const applied = await runMigrations(pool);
if (applied.length > 0) {
  console.log(`[worker] applied migrations: ${applied.join(", ")}`);
}

console.log(`[worker] polling every ${config.POLL_INTERVAL_MS}ms`);

let running = true;
process.on("SIGINT", () => {
  running = false;
});
process.on("SIGTERM", () => {
  running = false;
});

while (running) {
  await sleep(config.POLL_INTERVAL_MS);
}

await pool.end();
storage.destroy();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
