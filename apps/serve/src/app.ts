import { pipeline } from "node:stream/promises";
import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import {
  type Config,
  type Logger,
  compressedKey,
  loggerFor,
  pingDatabase,
  requestId,
  siteKey,
} from "@silver/shared";
import express, { type ErrorRequestHandler, type Express, type Response } from "express";
import mime from "mime-types";
import type pg from "pg";
import { cacheControlFor } from "./caching.js";
import { acceptsBrotli, varyOnEncoding } from "./encoding.js";
import { DeploymentLookup } from "./lookup.js";
import { EXPIRED_PAGE, NOT_FOUND_PAGE, UNAVAILABLE_PAGE } from "./pages.js";
import { deploymentIdFromHost, looksLikeClientRoute, storageKeyForPath } from "./routing.js";

export interface Dependencies {
  config: Config;
  pool: pg.Pool;
  storage: S3Client;
  log: Logger;
}

interface StoredObject {
  body: NodeJS.ReadableStream;
  contentLength?: number;
  etag?: string;
}

export function createApp({ config, pool, storage, log }: Dependencies): Express {
  const app = express();
  const lookup = new DeploymentLookup(pool);

  app.disable("x-powered-by");
  app.use(requestId(log));

  app.get("/healthz", async (_request, response) => {
    try {
      await pingDatabase(pool);
      response.json({ status: "ok" });
    } catch {
      response.status(503).json({ status: "degraded", failing: ["database"] });
    }
  });

  app.get("/{*splat}", async (request, response) => {
    const deploymentId = deploymentIdFromHost(request.headers.host);
    if (!deploymentId) {
      sendPage(response, 404, NOT_FOUND_PAGE);
      return;
    }

    const status = await lookup.statusOf(deploymentId);
    if (status === "EXPIRED") {
      sendPage(response, 410, EXPIRED_PAGE);
      return;
    }
    if (status !== "READY") {
      sendPage(response, 404, NOT_FOUND_PAGE);
      return;
    }

    const key = storageKeyForPath(deploymentId, request.path);
    if (!key) {
      sendPage(response, 404, NOT_FOUND_PAGE);
      return;
    }

    const ifNoneMatch = request.headers["if-none-match"];
    const wantsBrotli = acceptsBrotli(request.headers["accept-encoding"]);
    const requested = await fetchVariant(storage, config.S3_BUCKET, key, ifNoneMatch, wantsBrotli);

    if (requested.object === "not-modified") {
      sendNotModified(response, key);
      return;
    }

    if (requested.object) {
      await streamObject(response, key, requested.object, requested.encoding);
      return;
    }

    if (!looksLikeClientRoute(request.path)) {
      sendPage(response, 404, NOT_FOUND_PAGE);
      return;
    }

    const indexKey = siteKey(deploymentId, "index.html");
    const fallback = await fetchVariant(
      storage,
      config.S3_BUCKET,
      indexKey,
      ifNoneMatch,
      wantsBrotli,
    );

    if (fallback.object === "not-modified") {
      sendNotModified(response, indexKey);
      return;
    }

    if (!fallback.object) {
      sendPage(response, 404, NOT_FOUND_PAGE);
      return;
    }

    await streamObject(response, indexKey, fallback.object, fallback.encoding);
  });

  app.use(handleErrors(log));

  return app;
}

/**
 * These are somebody's live sites, so a database blip or an unreachable bucket
 * has to look like a page rather than like a stack trace. The visitor is told
 * their deployment is fine, because it is; only the path to its files is not.
 */
const handleErrors =
  (log: Logger): ErrorRequestHandler =>
  (error, _request, response, next) => {
    loggerFor(response, log).error("could not serve a request", error);

    if (response.headersSent) {
      next(error);
      return;
    }

    sendPage(response, 503, UNAVAILABLE_PAGE);
  };

async function fetchObject(
  storage: S3Client,
  bucket: string,
  key: string,
  ifNoneMatch: string | undefined,
): Promise<StoredObject | "not-modified" | null> {
  try {
    const object = await storage.send(
      new GetObjectCommand({ Bucket: bucket, Key: key, IfNoneMatch: ifNoneMatch }),
    );

    if (!object.Body) {
      return null;
    }

    return {
      body: object.Body as NodeJS.ReadableStream,
      contentLength: object.ContentLength,
      etag: object.ETag,
    };
  } catch (error) {
    if (statusCodeOf(error) === 304) {
      return "not-modified";
    }
    if (isMissing(error)) {
      return null;
    }
    throw error;
  }
}

type Encoding = "br" | null;

/**
 * Prefers the compressed twin the worker may have written, and falls back to
 * the original whenever it is absent or unwanted. The conditional header goes
 * to whichever object is tried, so a browser holding the Brotli ETag
 * revalidates against the Brotli object.
 */
async function fetchVariant(
  storage: S3Client,
  bucket: string,
  key: string,
  ifNoneMatch: string | undefined,
  wantsBrotli: boolean,
): Promise<{ object: StoredObject | "not-modified" | null; encoding: Encoding }> {
  if (wantsBrotli && varyOnEncoding(key)) {
    const compressed = await fetchObject(storage, bucket, compressedKey(key), ifNoneMatch);
    if (compressed) {
      return { object: compressed, encoding: "br" };
    }
  }

  return { object: await fetchObject(storage, bucket, key, ifNoneMatch), encoding: null };
}

/** A 304 carries no body but still has to say what the answer varied on. */
function sendNotModified(response: Response, key: string): void {
  setSafetyHeaders(response);
  setVaryIfCompressible(response, key);
  response.status(304).end();
}

/**
 * Headers follow the resolved key, not the request path: "/" carries no
 * extension to read a type or a caching rule from, but the key it resolved to
 * ends in index.html.
 */
async function streamObject(
  response: Response,
  key: string,
  object: StoredObject,
  encoding: Encoding,
): Promise<void> {
  setSafetyHeaders(response);
  setVaryIfCompressible(response, key);
  response.setHeader("Content-Type", mime.lookup(key) || "application/octet-stream");
  response.setHeader("Cache-Control", cacheControlFor(key));

  if (encoding) {
    response.setHeader("Content-Encoding", encoding);
  }

  if (object.contentLength !== undefined) {
    response.setHeader("Content-Length", object.contentLength);
  }
  if (object.etag) {
    response.setHeader("ETag", object.etag);
  }

  try {
    await pipeline(object.body, response);
  } catch (error) {
    // A visitor who navigates away mid-download is ordinary browsing, not a
    // fault. Logging it would fill the log with alarms nobody should act on.
    if (!isClientDisconnect(error)) {
      throw error;
    }
  }
}

function isClientDisconnect(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === "ERR_STREAM_PREMATURE_CLOSE" || code === "ECONNRESET" || code === "EPIPE";
}

function sendPage(response: Response, status: number, html: string): void {
  setSafetyHeaders(response);
  response.status(status).type("html").send(html);
}

/**
 * Everything served here was uploaded by a stranger. A deployment gets its own
 * subdomain, so browsers already keep one site out of another's data, but that
 * says nothing about the bytes within a single response: without nosniff a
 * browser is free to decide a file the server called text is really script.
 */
function setSafetyHeaders(response: Response): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
}

/**
 * Set whether or not the compressed twin was the one served. A shared cache
 * that stored either answer without this would hand it to the next client
 * regardless of what that client can decode, and Brotli bytes reaching a
 * browser expecting plain text is unreadable garbage.
 */
function setVaryIfCompressible(response: Response, key: string): void {
  if (varyOnEncoding(key)) {
    response.setHeader("Vary", "Accept-Encoding");
  }
}

function statusCodeOf(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
}

function isMissing(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  return name === "NoSuchKey" || name === "NotFound" || statusCodeOf(error) === 404;
}
