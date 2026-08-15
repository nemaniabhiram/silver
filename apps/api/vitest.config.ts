import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Both suites here drive a real database and share the rate_limits and
    // deployments tables. Run in parallel, each one's setup truncates the
    // other's rows out from under it.
    fileParallelism: false,
  },
});
