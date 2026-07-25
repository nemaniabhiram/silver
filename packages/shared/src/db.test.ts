import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";

describe("createPool", () => {
  /**
   * An `error` event with no listener is how EventEmitter kills a process, and
   * the pool raises one whenever Postgres drops a connection that was sitting
   * idle. A restart of the database used to take every service down with it.
   */
  it("listens for idle connection errors rather than letting them end the process", async () => {
    const pool = createPool(loadConfig({}));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      expect(pool.listenerCount("error")).toBeGreaterThan(0);
      expect(() => {
        pool.emit("error", new Error("terminating connection due to administrator command"));
      }).not.toThrow();
    } finally {
      vi.restoreAllMocks();
      await pool.end();
    }
  });
});
