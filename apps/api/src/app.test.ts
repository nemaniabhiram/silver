import { deflateRawSync } from "node:zlib";
import {
  createPool,
  createStorageClient,
  ensureBucket,
  loadConfig,
  runMigrations,
} from "@silver/shared";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const config = loadConfig({ ...process.env, RATE_LIMIT_DEPLOYS_PER_HOUR: "3" });
const pool = createPool(config);
const storage = createStorageClient(config);

const reachable = await Promise.all([
  runMigrations(pool),
  ensureBucket(storage, config.S3_BUCKET),
]).then(
  () => true,
  () => false,
);

afterAll(async () => {
  await pool.end();
  storage.destroy();
});

/** A real, minimal zip — the api checks the header bytes, not the filename. */
function zipContaining(name: string, contents: string): Buffer {
  const nameBytes = Buffer.from(name, "utf8");
  const body = Buffer.from(contents, "utf8");
  const compressed = deflateRawSync(body);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(0, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(0, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(body.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);

  const centralSize = central.length + nameBytes.length;
  const offset = local.length + nameBytes.length + compressed.length;

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([local, nameBytes, compressed, central, nameBytes, end]);
}

const SITE_ZIP = zipContaining("index.html", "<!doctype html><title>t</title>");

describe.skipIf(!reachable)("the deployments api", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    await pool.query("TRUNCATE deployments CASCADE");
    // A fresh app means fresh in-memory counters, so quota tests do not
    // inherit spend from the test before them.
    app = createApp({ config, pool, storage });
  });

  function upload() {
    return request(app).post("/deployments").attach("file", SITE_ZIP, "site.zip");
  }

  describe("POST /deployments", () => {
    it("accepts a zip and queues it", async () => {
      const response = await upload().expect(201);

      expect(response.body.id).toMatch(/^[a-z0-9]{10}$/);
      expect(response.body.status).toBe("QUEUED");
      expect(response.body.url).toContain(response.body.id);
      expect(new Date(response.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it("refuses a file that is not a zip, whatever it is named", async () => {
      const response = await request(app)
        .post("/deployments")
        .attach("file", Buffer.from("just some text"), "site.zip")
        .expect(400);

      expect(response.body.error.code).toBe("INVALID_UPLOAD");
    });

    it("refuses a request with no file", async () => {
      const response = await request(app).post("/deployments").expect(400);
      expect(response.body.error.code).toBe("INVALID_UPLOAD");
    });

    it("refuses an unknown preset", async () => {
      const response = await request(app)
        .post("/deployments")
        .field("preset", "webpack")
        .attach("file", SITE_ZIP, "site.zip")
        .expect(400);

      expect(response.body.error.message).toContain("static, vite, cra, npm");
    });

    it("records a preset the caller does name", async () => {
      const response = await upload().field("preset", "static").expect(201);
      expect(response.body.requestedPreset).toBe("static");
    });
  });

  describe("quota", () => {
    it("spends quota on deployments created", async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await upload().expect(201);
      }

      const blocked = await upload().expect(429);
      expect(blocked.body.error.code).toBe("RATE_LIMITED");
      expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    });

    it("does not spend quota on uploads it rejects", async () => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await request(app)
          .post("/deployments")
          .attach("file", Buffer.from("not a zip"), "site.zip")
          .expect(400);
      }

      // All three deployments are still available after eight fumbles.
      await upload().expect(201);
      await upload().expect(201);
      await upload().expect(201);
      await upload().expect(429);
    });
  });

  describe("GET /deployments/:id", () => {
    it("returns the deployment", async () => {
      const { body } = await upload().expect(201);
      const response = await request(app).get(`/deployments/${body.id}`).expect(200);
      expect(response.body.id).toBe(body.id);
    });

    it("is a 404 for unknown and malformed ids alike", async () => {
      await request(app).get("/deployments/zzzzzzzzzz").expect(404);
      await request(app).get("/deployments/NOT-AN-ID").expect(404);
    });
  });

  describe("lifecycle", () => {
    it("cancels a queued deployment once", async () => {
      const { body } = await upload().expect(201);

      const cancelled = await request(app).post(`/deployments/${body.id}/cancel`).expect(200);
      expect(cancelled.body.status).toBe("CANCELLED");

      const again = await request(app).post(`/deployments/${body.id}/cancel`).expect(409);
      expect(again.body.error.code).toBe("INVALID_STATE");
    });

    it("retries a cancelled deployment and clears what the last run left", async () => {
      const { body } = await upload().expect(201);
      await request(app).post(`/deployments/${body.id}/cancel`).expect(200);
      await pool.query("UPDATE deployments SET attempt_count = 2, error_message = 'boom' WHERE id = $1", [body.id]);

      const retried = await request(app).post(`/deployments/${body.id}/retry`).expect(200);

      expect(retried.body.status).toBe("QUEUED");
      expect(retried.body.attemptCount).toBe(0);
      expect(retried.body.errorMessage).toBeNull();
    });

    it("refuses to retry something that has not finished", async () => {
      const { body } = await upload().expect(201);
      await request(app).post(`/deployments/${body.id}/retry`).expect(409);
    });

    it("redeploys a finished deployment under a new id", async () => {
      const { body } = await upload().expect(201);
      await pool.query("UPDATE deployments SET status = 'READY' WHERE id = $1", [body.id]);

      const copy = await request(app).post(`/deployments/${body.id}/redeploy`).expect(201);

      expect(copy.body.id).not.toBe(body.id);
      expect(copy.body.status).toBe("QUEUED");
      expect(copy.body.sourceSizeBytes).toBe(body.sourceSizeBytes);
    });

    it("refuses to redeploy an expired deployment, whose source is gone", async () => {
      const { body } = await upload().expect(201);
      await pool.query("UPDATE deployments SET status = 'EXPIRED' WHERE id = $1", [body.id]);

      const response = await request(app).post(`/deployments/${body.id}/redeploy`).expect(409);
      expect(response.body.error.message).toContain("expired");
    });
  });

  describe("GET /deployments/:id/logs", () => {
    it("returns only what is newer than afterId", async () => {
      const { body } = await upload().expect(201);
      await pool.query(
        "INSERT INTO deployment_logs (deployment_id, message) SELECT $1, * FROM unnest($2::text[])",
        [body.id, ["first", "second", "third"]],
      );

      const all = await request(app).get(`/deployments/${body.id}/logs`).expect(200);
      expect(all.body.logs.map((line: { message: string }) => line.message)).toEqual([
        "first",
        "second",
        "third",
      ]);

      const since = await request(app)
        .get(`/deployments/${body.id}/logs?afterId=${all.body.logs[0].id}`)
        .expect(200);
      expect(since.body.logs).toHaveLength(2);

      const caughtUp = await request(app)
        .get(`/deployments/${body.id}/logs?afterId=${all.body.lastId}`)
        .expect(200);
      expect(caughtUp.body.logs).toHaveLength(0);
    });
  });

  describe("GET /healthz", () => {
    it("reports both dependencies as reachable", async () => {
      const response = await request(app).get("/healthz").expect(200);
      expect(response.body.status).toBe("ok");
    });
  });
});
