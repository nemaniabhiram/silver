import type { S3Client } from "@aws-sdk/client-s3";
import { type Config, pingDatabase } from "@silver/shared";
import express, { type Express } from "express";
import type pg from "pg";

export interface Dependencies {
  config: Config;
  pool: pg.Pool;
  storage: S3Client;
}

export function createApp({ pool }: Dependencies): Express {
  const app = express();

  app.get("/healthz", async (_request, response) => {
    try {
      await pingDatabase(pool);
      response.json({ status: "ok" });
    } catch {
      response.status(503).json({ status: "degraded", failing: ["database"] });
    }
  });

  return app;
}
