import { pipeline } from "node:stream/promises";
import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { type Config, pingDatabase, siteKey } from "@silver/shared";
import express, { type Express, type Response } from "express";
import mime from "mime-types";
import type pg from "pg";
import { cacheControlFor } from "./caching.js";
import { DeploymentLookup } from "./lookup.js";
import { EXPIRED_PAGE, NOT_FOUND_PAGE } from "./pages.js";
import { deploymentIdFromHost, looksLikeClientRoute, storageKeyForPath } from "./routing.js";

export interface Dependencies {
  config: Config;
  pool: pg.Pool;
  storage: S3Client;
}

interface StoredObject {
  body: NodeJS.ReadableStream;
  contentLength?: number;
  etag?: string;
}

export function createApp({ config, pool, storage }: Dependencies): Express {
  const app = express();
  const lookup = new DeploymentLookup(pool);

  app.disable("x-powered-by");

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
    const requested = await fetchObject(storage, config.S3_BUCKET, key, ifNoneMatch);

    if (requested === "not-modified") {
      response.status(304).end();
      return;
    }

    if (requested) {
      await streamObject(response, key, requested);
      return;
    }

    if (!looksLikeClientRoute(request.path)) {
      sendPage(response, 404, NOT_FOUND_PAGE);
      return;
    }

    const indexKey = siteKey(deploymentId, "index.html");
    const fallback = await fetchObject(storage, config.S3_BUCKET, indexKey, ifNoneMatch);

    if (fallback === "not-modified") {
      response.status(304).end();
      return;
    }

    if (!fallback) {
      sendPage(response, 404, NOT_FOUND_PAGE);
      return;
    }

    await streamObject(response, indexKey, fallback);
  });

  return app;
}

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

/**
 * Headers follow the resolved key, not the request path: "/" carries no
 * extension to read a type or a caching rule from, but the key it resolved to
 * ends in index.html.
 */
async function streamObject(
  response: Response,
  key: string,
  object: StoredObject,
): Promise<void> {
  response.setHeader("Content-Type", mime.lookup(key) || "application/octet-stream");
  response.setHeader("Cache-Control", cacheControlFor(key));

  if (object.contentLength !== undefined) {
    response.setHeader("Content-Length", object.contentLength);
  }
  if (object.etag) {
    response.setHeader("ETag", object.etag);
  }

  await pipeline(object.body, response);
}

function sendPage(response: Response, status: number, html: string): void {
  response.status(status).type("html").send(html);
}

function statusCodeOf(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
}

function isMissing(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  return name === "NoSuchKey" || name === "NotFound" || statusCodeOf(error) === 404;
}
