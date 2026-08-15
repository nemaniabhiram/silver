import { type AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";
import type { Server } from "node:http";
import type { S3Client } from "@aws-sdk/client-s3";
import {
  createLogger,
  createPool,
  loadConfig,
  newDeploymentId,
  notifyDeploymentChanged,
  runMigrations,
} from "@silver/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { DeploymentEvents, startEventListener } from "./events.js";

const config = loadConfig();
const log = createLogger("stream-test");
const pool = createPool(config, log);

const reachable = await runMigrations(pool).then(
  () => true,
  () => false,
);

const storage = {} as S3Client;

interface OpenStream {
  events: ParsedEvent[];
  close(): void;
  waitFor(count: number, timeoutMs?: number): Promise<void>;
  /** Every stream opens with a status event, so log counts need naming. */
  waitForNamed(name: string, count: number, timeoutMs?: number): Promise<void>;
}

interface ParsedEvent {
  id: string | null;
  name: string;
  data: string;
}

/**
 * A minimal SSE reader. supertest buffers the whole response, which a stream
 * that stays open never finishes, so this reads the socket as it arrives.
 */
function openStream(
  server: Server,
  path: string,
  headers: Record<string, string> = {},
): OpenStream {
  const { port } = server.address() as AddressInfo;
  const events: ParsedEvent[] = [];
  let buffer = "";

  const outbound = httpRequest({ host: "127.0.0.1", port, path, headers }, (response) => {
    response.setEncoding("utf8");
    response.on("data", (chunk: string) => {
      buffer += chunk;

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        if (!block.startsWith(":")) {
          const lines = block.split("\n");
          events.push({
            id: lines.find((line) => line.startsWith("id: "))?.slice(4) ?? null,
            name: lines.find((line) => line.startsWith("event: "))?.slice(7) ?? "message",
            data: lines.find((line) => line.startsWith("data: "))?.slice(6) ?? "",
          });
        }

        boundary = buffer.indexOf("\n\n");
      }
    });
  });

  outbound.end();

  return {
    events,
    close: () => outbound.destroy(),
    async waitFor(count, timeoutMs = 5_000) {
      const deadline = Date.now() + timeoutMs;
      while (events.length < count) {
        if (Date.now() > deadline) {
          throw new Error(`only ${events.length} of ${count} events arrived`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
    async waitForNamed(name, count, timeoutMs = 5_000) {
      const deadline = Date.now() + timeoutMs;
      const matching = () => events.filter((event) => event.name === name).length;

      while (matching() < count) {
        if (Date.now() > deadline) {
          throw new Error(`only ${matching()} of ${count} ${name} events arrived`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
  };
}

async function seedDeployment(): Promise<string> {
  const id = newDeploymentId();
  await pool.query(
    `INSERT INTO deployments (id, status, source_key, source_size_bytes, expires_at)
     VALUES ($1, 'BUILDING', $2, 1, now() + interval '1 day')`,
    [id, `sources/${id}.zip`],
  );
  return id;
}

async function writeLog(deploymentId: string, message: string): Promise<void> {
  await pool.query("INSERT INTO deployment_logs (deployment_id, message) VALUES ($1, $2)", [
    deploymentId,
    message,
  ]);
  await notifyDeploymentChanged(pool, deploymentId);
}

describe.skipIf(!reachable)("the deployment event stream", () => {
  let server: Server;
  let listener: ReturnType<typeof startEventListener>;

  beforeEach(async () => {
    await pool.query("TRUNCATE deployments CASCADE");
    await pool.query("TRUNCATE rate_limits");

    const events = new DeploymentEvents();
    listener = startEventListener(config, log, events);
    server = createApp({ config, pool, storage, log }, events).listen(0);

    // The listener connects and issues LISTEN asynchronously.
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

  afterAll(async () => {
    await pool.end();
  });

  it("replays what already happened before waiting for more", async () => {
    const id = await seedDeployment();
    await writeLog(id, "first");
    await writeLog(id, "second");

    const stream = openStream(server, `/deployments/${id}/events`);
    await stream.waitForNamed("log", 2);

    const logs = stream.events.filter((event) => event.name === "log");
    expect(logs.map((event) => JSON.parse(event.data).message)).toEqual(["first", "second"]);

    stream.close();
    listener.stop().catch(() => undefined);
    server.close();
  });

  it("delivers a line written after the stream opened", async () => {
    const id = await seedDeployment();
    const stream = openStream(server, `/deployments/${id}/events`);
    await new Promise((resolve) => setTimeout(resolve, 200));

    await writeLog(id, "written while watching");
    await stream.waitForNamed("log", 1);

    const line = stream.events.find((event) => event.name === "log");
    expect(JSON.parse(line?.data ?? "{}").message).toBe("written while watching");

    stream.close();
    listener.stop().catch(() => undefined);
    server.close();
  });

  /**
   * The resume that the log table's bigserial makes almost free. A browser
   * reconnecting sends back the last id it saw, and must be given what follows
   * it: no line missed, and none repeated.
   */
  it("resumes from Last-Event-ID with nothing lost and nothing repeated", async () => {
    const id = await seedDeployment();
    await writeLog(id, "one");
    await writeLog(id, "two");
    await writeLog(id, "three");

    const first = openStream(server, `/deployments/${id}/events`);
    await first.waitForNamed("log", 3);
    const firstId = first.events.find((event) => event.name === "log")?.id;
    first.close();

    expect(firstId).not.toBeNull();

    const resumed = openStream(server, `/deployments/${id}/events`, {
      "Last-Event-ID": String(firstId),
    });
    await resumed.waitForNamed("log", 2);

    const messages = resumed.events
      .filter((event) => event.name === "log")
      .map((event) => JSON.parse(event.data).message);

    expect(messages).toEqual(["two", "three"]);

    resumed.close();
    listener.stop().catch(() => undefined);
    server.close();
  });

  it("carries a status change on the same stream, with no id to corrupt the cursor", async () => {
    const id = await seedDeployment();
    const stream = openStream(server, `/deployments/${id}/events`);
    await stream.waitForNamed("status", 1);

    const status = stream.events.find((event) => event.name === "status");
    expect(status).toBeDefined();
    expect(status?.id).toBeNull();
    expect(JSON.parse(status?.data ?? "{}").status).toBe("BUILDING");

    stream.close();
    listener.stop().catch(() => undefined);
    server.close();
  });
});
