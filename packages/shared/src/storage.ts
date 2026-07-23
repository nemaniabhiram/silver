import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type { Config } from "./config.js";

export function createStorageClient(config: Config): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: config.S3_ENDPOINT,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY,
      secretAccessKey: config.S3_SECRET_KEY,
    },
  });
}

export async function pingBucket(storage: S3Client, bucket: string): Promise<void> {
  await storage.send(new HeadBucketCommand({ Bucket: bucket }));
}

export function sourceKey(deploymentId: string): string {
  return `sources/${deploymentId}.zip`;
}

export function siteKey(deploymentId: string, relativePath: string): string {
  return `sites/${deploymentId}/${relativePath}`;
}

export function sitePrefix(deploymentId: string): string {
  return `sites/${deploymentId}/`;
}
