import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { Config } from "./config.js";

const { Pool } = pg;

export const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "migrations",
);

const MIGRATION_LOCK_ID = 7734001;

export function createPool(config: Config): pg.Pool {
  const pool = new Pool({ connectionString: config.DATABASE_URL, max: 5 });

  /**
   * A client sitting idle in the pool when Postgres restarts or drops the
   * connection raises an `error` event on the pool itself, and an unheard
   * `error` event is how EventEmitter kills a process. Postgres restarting is
   * not a reason for every service to exit: the pool discards the dead client
   * and the next query opens a fresh one, so this is worth a line in the log
   * and nothing more.
   */
  pool.on("error", (error) => {
    console.error("[db] idle connection lost", error.message);
  });

  return pool;
}

export async function pingDatabase(pool: pg.Pool): Promise<void> {
  await pool.query("SELECT 1");
}

export async function runMigrations(
  pool: pg.Pool,
  migrationsDir: string = MIGRATIONS_DIR,
): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version    text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );

    const applied = new Set(
      (await client.query<{ version: string }>("SELECT version FROM schema_migrations")).rows.map(
        (row) => row.version,
      ),
    );

    const pending = (await readdir(migrationsDir))
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .filter((file) => !applied.has(versionOf(file)));

    for (const file of pending) {
      const sql = await readFile(join(migrationsDir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [
          versionOf(file),
        ]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
      }
    }

    return pending.map(versionOf);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
    client.release();
  }
}

function versionOf(migrationFile: string): string {
  return migrationFile.replace(/\.sql$/, "");
}
