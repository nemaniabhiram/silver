import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createLogWriter } from "./logs.js";

function recordingPool() {
  const batches: string[][] = [];
  const query = vi.fn((_sql: string, values: unknown[]) => {
    batches.push(values[1] as string[]);
    return Promise.resolve({ rows: [] });
  });
  return { pool: { query } as unknown as Pool, batches, query };
}

describe("createLogWriter", () => {
  it("batches rather than writing a row per line", async () => {
    const { pool, batches, query } = recordingPool();
    const writer = createLogWriter(pool, "abc1234567");

    for (let line = 0; line < 60; line += 1) {
      writer.write(`line ${line}`);
    }
    await writer.close();

    expect(query.mock.calls.length).toBeLessThan(60);
    expect(batches.flat()).toHaveLength(60);
  });

  it("writes everything still buffered when it closes", async () => {
    const { pool, batches } = recordingPool();
    const writer = createLogWriter(pool, "abc1234567");

    writer.write("only line");
    await writer.close();

    expect(batches.flat()).toEqual(["only line"]);
  });

  it("stops and says so once a build floods the log", async () => {
    const { pool, batches } = recordingPool();
    const writer = createLogWriter(pool, "abc1234567", 100);

    for (let line = 0; line < 500; line += 1) {
      writer.write("x".repeat(50));
    }
    await writer.close();

    const written = batches.flat();
    expect(written.at(-1)).toBe("[silver] log truncated");
    expect(written.filter((line) => line === "[silver] log truncated")).toHaveLength(1);
    expect(written.length).toBeLessThan(10);
  });

  it("keeps writing when a batch fails, since logs are not the deployment", async () => {
    const query = vi.fn().mockRejectedValue(new Error("connection lost"));
    const writer = createLogWriter({ query } as unknown as Pool, "abc1234567");

    writer.write("a line");
    await expect(writer.close()).resolves.toBeUndefined();
  });
});
