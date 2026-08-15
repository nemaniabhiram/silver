import {
  createLogger,
  createPool,
  createStorageClient,
  loadConfig,
  runMigrations,
  shutdownOnSignal,
} from "@silver/shared";
import { createApp } from "./app.js";

const config = loadConfig();
const log = createLogger("api", config.LOG_FORMAT);
const pool = createPool(config, log);
const storage = createStorageClient(config);

const applied = await runMigrations(pool);
if (applied.length > 0) {
  log.info("applied migrations", { migrations: applied.join(", ") });
}

const server = createApp({ config, pool, storage, log }).listen(config.API_PORT, () => {
  log.info("listening", { url: `http://localhost:${config.API_PORT}` });
});

shutdownOnSignal(log, server, async () => {
  await pool.end();
  storage.destroy();
});
