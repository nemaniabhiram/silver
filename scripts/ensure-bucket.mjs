#!/usr/bin/env node
// Creates the storage bucket when it is missing. Safe to run repeatedly.
import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";

const bucket = process.env.S3_BUCKET ?? "silver";

const storage = new S3Client({
  region: "auto",
  endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? "silver",
    secretAccessKey: process.env.S3_SECRET_KEY ?? "silver-secret",
  },
});

try {
  await storage.send(new HeadBucketCommand({ Bucket: bucket }));
  console.log(`bucket "${bucket}" already exists`);
} catch {
  await storage.send(new CreateBucketCommand({ Bucket: bucket }));
  console.log(`bucket "${bucket}" created`);
}
