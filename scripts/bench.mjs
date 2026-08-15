#!/usr/bin/env node
// Measures the two numbers the README quotes: how fast a drop goes live, and
// what the serve hot path sustains. Run against a started dev stack:
//   pnpm infra:up && pnpm dev   (api, worker and serve must be up)
//   pnpm fixtures
//   pnpm bench
// Usage: node scripts/bench.mjs [--api http://localhost:4000] [--site-host localhost:4001]
//        [--runs 5] [--duration 10] [--concurrency 50]
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const options = parseArgs(process.argv.slice(2));
const apiBase = options.api ?? "http://localhost:4000";
const siteHost = options["site-host"] ?? "localhost:4001";
const deployRuns = Number(options.runs ?? 5);
const loadSeconds = Number(options.duration ?? 10);
const concurrency = Number(options.concurrency ?? 50);

await assertStackUp();

console.log(`\n== drop -> live, static site (${deployRuns} runs) ==`);
const durations = [];
let liveId = null;

for (let run = 1; run <= deployRuns; run += 1) {
  const { ms, id } = await deployAndAwaitFirstByte("fixtures/static-site.zip");
  durations.push(ms);
  liveId = id;
  console.log(`  run ${run}: ${ms.toFixed(0)} ms`);
}

durations.sort((a, b) => a - b);
const median = durations[Math.floor(durations.length / 2)];
console.log(`  median: ${median.toFixed(0)} ms`);

console.log(`\n== serve hot path, ${loadSeconds}s at concurrency ${concurrency} ==`);
const { completed, latencies } = await loadTest(liveId);

latencies.sort((a, b) => a - b);
const at = (p) =>
  latencies[Math.min(latencies.length - 1, Math.floor((latencies.length * p) / 100))];
console.log(`  ${completed} requests -> ${(completed / loadSeconds).toFixed(0)} req/s`);
console.log(
  `  p50 ${at(50).toFixed(1)} ms · p95 ${at(95).toFixed(1)} ms · p99 ${at(99).toFixed(1)} ms`,
);
console.log("\n== transfer size, compressed against raw ==");
await reportTransferSizes(liveId);

console.log(
  "\nMethodology: loopback, local MinIO, network RTT excluded. Numbers are\nsingle-node capacity on the machine running this script.",
);

/**
 * Compression happens once when a site is built, so this is a property of what
 * is stored rather than of the request path, and it costs the numbers above
 * nothing.
 */
async function reportTransferSizes(id) {
  const assets = ["/", "/app.js", "/style.css"];
  let raw = 0;
  let compressed = 0;

  for (const path of assets) {
    const plain = await siteFetch(id, path, { "Accept-Encoding": "identity" });
    const brotli = await siteFetch(id, path, { "Accept-Encoding": "br" });
    raw += plain.bytes;
    compressed += brotli.bytes;

    const saved =
      plain.bytes === 0 ? 0 : Math.round(((plain.bytes - brotli.bytes) / plain.bytes) * 100);
    console.log(
      `  ${path.padEnd(12)} ${String(plain.bytes).padStart(8)} -> ${String(brotli.bytes).padStart(8)}  ${brotli.encoding ?? "uncompressed"} (${saved}%)`,
    );
  }

  const saved = Math.round(((raw - compressed) / raw) * 100);
  console.log(
    `  ${"total".padEnd(12)} ${String(raw).padStart(8)} -> ${String(compressed).padStart(8)}  (${saved}% smaller)`,
  );
}

/** Wall clock from starting the upload to the first 200 from the subdomain. */
async function deployAndAwaitFirstByte(fixture) {
  const zip = await readFile(resolve(ROOT, fixture));
  const form = new FormData();
  form.append("file", new Blob([zip], { type: "application/zip" }), "site.zip");

  const startedAt = performance.now();
  const created = await (
    await fetch(`${apiBase}/deployments`, { method: "POST", body: form })
  ).json();
  if (!created.id) {
    throw new Error(`upload refused: ${JSON.stringify(created)}`);
  }

  for (;;) {
    const deployment = await (await fetch(`${apiBase}/deployments/${created.id}`)).json();
    if (deployment.status === "READY") break;
    if (deployment.status !== "QUEUED" && deployment.status !== "BUILDING") {
      throw new Error(`deployment ended ${deployment.status}: ${deployment.errorMessage}`);
    }
    await sleep(100);
  }

  const page = await siteFetch(created.id);
  if (page.status !== 200) {
    throw new Error(`live site answered ${page.status}`);
  }

  return { ms: performance.now() - startedAt, id: created.id };
}

async function loadTest(id) {
  const latencies = [];
  let completed = 0;
  const endAt = performance.now() + loadSeconds * 1000;

  async function worker() {
    while (performance.now() < endAt) {
      const startedAt = performance.now();
      const response = await siteFetch(id).catch(() => null);
      if (response?.status === 200) {
        latencies.push(performance.now() - startedAt);
        completed += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return { completed, latencies };
}

/**
 * Requests go to loopback with the subdomain in the Host header, because
 * Node's resolver, unlike a browser's, does not map *.localhost.
 */
function siteFetch(id, path = "/", headers = {}) {
  const port = siteHost.split(":")[1] ?? "80";

  return new Promise((resolveResponse, rejectResponse) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port: Number(port),
        path,
        headers: { Host: `${id}.${siteHost}`, ...headers },
      },
      (response) => {
        // Counted rather than collected: the load test runs thousands of these
        // and only ever needs the size.
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
        });
        response.on("end", () =>
          resolveResponse({
            status: response.statusCode ?? 0,
            bytes,
            encoding: response.headers["content-encoding"] ?? null,
          }),
        );
      },
    );
    request.on("error", rejectResponse);
    request.end();
  });
}

async function assertStackUp() {
  const probes = [
    [`${apiBase}/healthz`, "api"],
    [`http://127.0.0.1:${siteHost.split(":")[1] ?? "80"}/healthz`, "serve"],
  ];

  for (const [url, name] of probes) {
    const ok = await fetch(url).then(
      (r) => r.ok,
      () => false,
    );
    if (!ok) {
      console.error(
        `${name} is not answering at ${url}. Start the stack first (pnpm infra:up && pnpm dev).`,
      );
      process.exit(1);
    }
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith("--")) {
      parsed[argv[index].slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  return parsed;
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}
