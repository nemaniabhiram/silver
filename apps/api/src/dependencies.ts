import type { S3Client } from "@aws-sdk/client-s3";
import type { Config } from "@silver/shared";
import type pg from "pg";

export interface Dependencies {
  config: Config;
  pool: pg.Pool;
  storage: S3Client;
}
