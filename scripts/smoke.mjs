#!/usr/bin/env node
// End-to-end gate: upload a fixture, wait for it to go live, fetch it back.
// Usage: node scripts/smoke.mjs [--api http://localhost:4000] [--site-host localhost:4001]
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const options = parseArgs(process.argv.slice(2));
const apiBase = options.api ?? "http://localhost:4000";
const siteHost = options["site-host"] ?? "localhost:4001";
const siteProtocol = options["site-protocol"] ?? (siteHost.startsWith("localhost") ? "http" : "https");
const deadlineMs = Number(options.timeout ?? 120_000);

const checks = [];

try {
  await run();
  report();
} catch (error) {
  console.error(`\n  fatal: ${error.message}`);
  report();
  process.exit(1);
}

async function run() {
  const health = await fetch(`${apiBase}/healthz`);
  check("api is healthy", health.ok, `${health.status}`);

  const zip = await readFile(resolve(ROOT, "fixtures/static-site.zip"));
  const form = new FormData();
  form.append("file", new Blob([zip], { type: "application/zip" }), "site.zip");

  const created = await fetch(`${apiBase}/deployments`, { method: "POST", body: form });
  const deployment = await created.json();
  check("upload accepted", created.status === 201, `HTTP ${created.status}`);

  if (created.status !== 201) {
    throw new Error(`upload failed: ${JSON.stringify(deployment)}`);
  }

  console.log(`  deployment ${deployment.id}`);
  const ready = await waitForReady(deployment.id);
  check("reached READY", ready.status === "READY", `ended as ${ready.status}: ${ready.errorMessage ?? ""}`);

  if (ready.status !== "READY") {
    throw new Error("deployment never became ready");
  }

  check("recorded a checksum", Boolean(ready.outputFileCount), `${ready.outputFileCount} files`);

  const page = await siteFetch(deployment.id);
  const html = await page.text();

  check("site responds", page.ok, `HTTP ${page.status}`);
  check("serves the deployed html", html.includes("silver static fixture"), truncate(html));
  check(
    "labels html correctly",
    (page.headers.get("content-type") ?? "").startsWith("text/html"),
    page.headers.get("content-type"),
  );
  check("revalidates html", page.headers.get("cache-control") === "no-cache", page.headers.get("cache-control"));

  const image = await siteFetch(deployment.id, "/pixel.png");
  check("serves images as images", image.headers.get("content-type") === "image/png", image.headers.get("content-type"));

  const script = await siteFetch(deployment.id, "/app.js");
  check(
    "serves scripts as scripts",
    (script.headers.get("content-type") ?? "").includes("javascript"),
    script.headers.get("content-type"),
  );

  const styles = await siteFetch(deployment.id, "/style.css");
  check(
    "serves stylesheets as stylesheets",
    (styles.headers.get("content-type") ?? "").startsWith("text/css"),
    styles.headers.get("content-type"),
  );

  const etag = page.headers.get("etag");
  if (etag) {
    const revalidated = await siteFetch(deployment.id, "/", { "If-None-Match": etag });
    check("honours If-None-Match", revalidated.status === 304, `HTTP ${revalidated.status}`);
  }

  const clientRoute = await siteFetch(deployment.id, "/some/client/route");
  const routeBody = await clientRoute.text();
  check("falls back to index.html for client routes", routeBody.includes("silver static fixture"), `HTTP ${clientRoute.status}`);

  const missingAsset = await siteFetch(deployment.id, "/missing.png");
  check("404s a missing asset", missingAsset.status === 404, `HTTP ${missingAsset.status}`);

  const unknownSite = await siteFetch("nonexist123");
  check("404s an unknown subdomain", unknownSite.status === 404, `HTTP ${unknownSite.status}`);
}

/**
 * Node's resolver does not map *.localhost to loopback the way browsers do, so
 * dev requests go to the loopback address carrying the subdomain in Host —
 * which is what serve routes on anyway.
 */
function siteFetch(deploymentId, path = "/", headers = {}) {
  const host = `${deploymentId}.${siteHost}`;

  if (!siteHost.startsWith("localhost") && !siteHost.startsWith("127.")) {
    return fetch(`${siteProtocol}://${host}${path}`, { headers });
  }

  const [, port = "80"] = siteHost.split(":");
  const send = siteProtocol === "https" ? httpsRequest : httpRequest;

  return new Promise((resolveResponse, rejectResponse) => {
    const outbound = send(
      { host: "127.0.0.1", port: Number(port), path, headers: { ...headers, Host: host } },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks);
          resolveResponse({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            headers: { get: (name) => response.headers[name.toLowerCase()] ?? null },
            text: async () => body.toString("utf8"),
          });
        });
      },
    );

    outbound.on("error", rejectResponse);
    outbound.end();
  });
}

async function waitForReady(id) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < deadlineMs) {
    const response = await fetch(`${apiBase}/deployments/${id}`);
    const deployment = await response.json();

    if (deployment.status !== "QUEUED" && deployment.status !== "BUILDING") {
      return deployment;
    }

    await sleep(1000);
  }

  throw new Error(`timed out after ${deadlineMs}ms`);
}

function check(name, passed, detail = "") {
  checks.push({ name, passed });
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${passed || !detail ? "" : `  (${detail})`}`);
}

function report() {
  const failed = checks.filter((entry) => !entry.passed);
  console.log(`\n  ${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith("--")) {
      parsed[arg.slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  return parsed;
}

function truncate(text) {
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}
