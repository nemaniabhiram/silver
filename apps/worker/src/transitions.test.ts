import {
  DEPLOYMENT_STATUSES,
  type DeploymentStatus,
  VALID_TRANSITIONS,
  createPool,
  loadConfig,
  newDeploymentId,
  runMigrations,
  transitionDeployment,
} from "@silver/shared";
import { afterAll, describe, expect, it } from "vitest";

const config = loadConfig();
const pool = createPool(config);

// Resolved before the suite is registered — skipIf is evaluated then, so a flag
// set in beforeAll would come too late and the suite would run against nothing.
const reachable = await runMigrations(pool).then(
  () => true,
  () => false,
);

afterAll(async () => {
  await pool.end();
});

async function seed(status: DeploymentStatus): Promise<string> {
  const id = newDeploymentId();
  await pool.query(
    `INSERT INTO deployments (id, status, source_key, source_size_bytes, expires_at)
     VALUES ($1, $2, $3, 1, now() + interval '7 days')`,
    [id, status, `sources/${id}.zip`],
  );
  return id;
}

describe.skipIf(!reachable)("the transition table, against the database", () => {
  it("permits every transition it declares", async () => {
    for (const from of DEPLOYMENT_STATUSES) {
      for (const to of VALID_TRANSITIONS[from]) {
        const id = await seed(from);
        const moved = await transitionDeployment(pool, id, from, to);
        expect(moved, `${from} -> ${to} should be allowed`).not.toBeNull();
        expect(moved?.status).toBe(to);
      }
    }
  });

  it("refuses every transition it does not declare", async () => {
    for (const from of DEPLOYMENT_STATUSES) {
      const illegal = DEPLOYMENT_STATUSES.filter((to) => !VALID_TRANSITIONS[from].includes(to));

      for (const to of illegal) {
        await expect(
          transitionDeployment(pool, await seed(from), from, to),
          `${from} -> ${to} should be refused`,
        ).rejects.toThrow(/Illegal deployment transition/);
      }
    }
  });

  it("leaves the row untouched when the status moved underneath it", async () => {
    const id = await seed("QUEUED");
    await transitionDeployment(pool, id, "QUEUED", "CANCELLED");

    const lateClaim = await transitionDeployment(pool, id, "QUEUED", "BUILDING");

    expect(lateClaim).toBeNull();
    const { rows } = await pool.query("SELECT status FROM deployments WHERE id = $1", [id]);
    expect(rows[0].status).toBe("CANCELLED");
  });

  it("accepts any of several permitted origins", async () => {
    for (const from of ["FAILED", "CANCELLED"] as const) {
      const retried = await transitionDeployment(
        pool,
        await seed(from),
        ["FAILED", "CANCELLED"],
        "QUEUED",
      );
      expect(retried?.status).toBe("QUEUED");
    }
  });

  it("cannot resurrect an expired deployment, whose files are already gone", async () => {
    const id = await seed("EXPIRED");
    await expect(transitionDeployment(pool, id, "EXPIRED", "QUEUED")).rejects.toThrow();
  });
});
