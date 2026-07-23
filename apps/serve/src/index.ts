import { createPool, createStorageClient, loadConfig, runMigrations } from "@silver/shared";
import { createApp } from "./app.js";

const config = loadConfig();
const pool = createPool(config);
const storage = createStorageClient(config);

const applied = await runMigrations(pool);
if (applied.length > 0) {
  console.log(`[serve] applied migrations: ${applied.join(", ")}`);
}

createApp({ config, pool, storage }).listen(config.SERVE_PORT, () => {
  console.log(`[serve] listening on http://localhost:${config.SERVE_PORT}`);
});
