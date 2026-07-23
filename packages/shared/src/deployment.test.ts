import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  DEPLOYMENT_STATUSES,
  VALID_TRANSITIONS,
  canTransition,
  deploymentUrl,
  transitionDeployment,
} from "./deployment.js";
import { loadConfig } from "./config.js";

describe("transition table", () => {
  it("covers every status", () => {
    expect(Object.keys(VALID_TRANSITIONS).sort()).toEqual([...DEPLOYMENT_STATUSES].sort());
  });

  it("only ever targets known statuses", () => {
    for (const targets of Object.values(VALID_TRANSITIONS)) {
      for (const target of targets) {
        expect(DEPLOYMENT_STATUSES).toContain(target);
      }
    }
  });

  it("allows the happy path", () => {
    expect(canTransition("QUEUED", "BUILDING")).toBe(true);
    expect(canTransition("BUILDING", "READY")).toBe(true);
    expect(canTransition("READY", "EXPIRED")).toBe(true);
  });

  it("rejects resurrection of terminal states", () => {
    expect(canTransition("EXPIRED", "QUEUED")).toBe(false);
    expect(canTransition("READY", "BUILDING")).toBe(false);
    expect(canTransition("QUEUED", "READY")).toBe(false);
  });
});

describe("transitionDeployment", () => {
  function poolReturning(rows: unknown[]) {
    const query = vi.fn().mockResolvedValue({ rows });
    return { pool: { query } as unknown as Pool, query };
  }

  it("refuses an illegal transition before touching the database", async () => {
    const { pool, query } = poolReturning([]);

    await expect(transitionDeployment(pool, "abc1234567", "READY", "BUILDING")).rejects.toThrow(
      /READY -> BUILDING/,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("guards on the current status so a lost race cannot overwrite it", async () => {
    const { pool, query } = poolReturning([]);

    const result = await transitionDeployment(pool, "abc1234567", "QUEUED", "BUILDING");

    expect(result).toBeNull();
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("WHERE id = $1 AND status = $2");
    expect(values.slice(0, 3)).toEqual(["abc1234567", "QUEUED", "BUILDING"]);
  });

  it("writes the extra columns it is handed", async () => {
    const { pool, query } = poolReturning([]);

    await transitionDeployment(pool, "abc1234567", "BUILDING", "FAILED", {
      error_message: "boom",
    });

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("error_message = $4");
    expect(values[3]).toBe("boom");
  });
});

describe("deploymentUrl", () => {
  it("is derived from config, never stored", () => {
    const config = loadConfig({ DEPLOY_PROTOCOL: "https", DEPLOY_DOMAIN: "silver.sh" });
    expect(deploymentUrl("x7k2m9qw4p", config)).toBe("https://x7k2m9qw4p.silver.sh");
  });
});
