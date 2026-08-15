import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Two suites here drive a real database, and they share one deployments
    // table. Run in parallel, each one's setup is the other's missing rows.
    fileParallelism: false,
  },
});
