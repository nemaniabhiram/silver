import { Readable } from "node:stream";
import type { S3Client } from "@aws-sdk/client-s3";
import { createLogger, loadConfig } from "@silver/shared";
import type pg from "pg";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";

const DEPLOYMENT_ID = "k3n8vq2wpd";
const HOST = `${DEPLOYMENT_ID}.localhost:4001`;

/** Enough of a pool to answer the one status query the lookup makes. */
function poolReturning(status: string): pg.Pool {
  return { query: () => Promise.resolve({ rows: [{ status }] }) } as unknown as pg.Pool;
}

function storageThatFails(error: Error): S3Client {
  return { send: () => Promise.reject(error) } as unknown as S3Client;
}

/** Answers every GET with the same small body, whatever key is asked for. */
function storageServing(body: string): S3Client {
  return {
    send: () =>
      Promise.resolve({
        Body: Readable.from([body]),
        ContentLength: body.length,
        ETag: '"abc123"',
      }),
  } as unknown as S3Client;
}

const log = createLogger("serve-test");

function appWith(pool: pg.Pool, storage: S3Client) {
  return createApp({ config: loadConfig({}), pool, storage, log });
}

describe("failures behind a live site", () => {
  beforeEach(() => {
    vi.spyOn(log, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers with a page when storage is unreachable, not with a stack trace", async () => {
    const app = appWith(
      poolReturning("READY"),
      storageThatFails(new Error("connect ECONNREFUSED")),
    );

    const response = await request(app).get("/index.html").set("Host", HOST);

    expect(response.status).toBe(503);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain("temporarily unavailable");
    expect(response.text).not.toContain("ECONNREFUSED");
    expect(response.text).not.toContain("at ");
  });

  it("answers with a page when the database is unreachable", async () => {
    const pool = {
      query: () => Promise.reject(new Error("terminating connection due to shutdown")),
    } as unknown as pg.Pool;

    const response = await request(appWith(pool, storageThatFails(new Error("unused"))))
      .get("/")
      .set("Host", HOST);

    expect(response.status).toBe(503);
    expect(response.text).toContain("temporarily unavailable");
    expect(response.text).not.toContain("terminating connection");
  });

  it("still reports an unknown host as missing rather than broken", async () => {
    const response = await request(appWith(poolReturning("READY"), storageThatFails(new Error())))
      .get("/")
      .set("Host", "localhost:4001");

    expect(response.status).toBe(404);
    expect(response.text).toContain("no site here");
  });
});

/**
 * These files came from a stranger, so the protections have to be on every way
 * out of the service, not only the happy one.
 */
describe("safety headers", () => {
  beforeEach(() => {
    vi.spyOn(log, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const expectSafe = (headers: Record<string, string | undefined>) => {
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  };

  it("sets them on a served asset", async () => {
    const response = await request(appWith(poolReturning("READY"), storageServing("body")))
      .get("/index.html")
      .set("Host", HOST);

    expect(response.status).toBe(200);
    expectSafe(response.headers);
  });

  it("sets them on an expired site", async () => {
    const response = await request(appWith(poolReturning("EXPIRED"), storageServing("body")))
      .get("/")
      .set("Host", HOST);

    expect(response.status).toBe(410);
    expectSafe(response.headers);
  });

  it("sets them on a missing site", async () => {
    const response = await request(appWith(poolReturning("READY"), storageServing("body")))
      .get("/")
      .set("Host", "localhost:4001");

    expect(response.status).toBe(404);
    expectSafe(response.headers);
  });

  it("sets them on the page shown when something breaks", async () => {
    const response = await request(
      appWith(poolReturning("READY"), storageThatFails(new Error("x"))),
    )
      .get("/index.html")
      .set("Host", HOST);

    expect(response.status).toBe(503);
    expectSafe(response.headers);
  });
});
