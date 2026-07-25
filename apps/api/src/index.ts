import {
  createPool,
  createStorageClient,
  loadConfig,
  runMigrations,
  shutdownOnSignal,
} from "@silver/shared";
import { createApp } from "./app.js";

const config = loadConfig();
const pool = createPool(config);
const storage = createStorageClient(config);

const applied = await runMigrations(pool);
if (applied.length > 0) {
  console.log(`[api] applied migrations: ${applied.join(", ")}`);
}

const server = createApp({ config, pool, storage }).listen(config.API_PORT, () => {
  console.log(`[api] listening on http://localhost:${config.API_PORT}`);
});

shutdownOnSignal("api", server, async () => {
  await pool.end();
  storage.destroy();
});
