import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { siteKey } from "@silver/shared";
import mime from "mime-types";
import { BuildFailure } from "./failure.js";

const MAX_FILES = 10_000;
const UPLOAD_CONCURRENCY = 8;

export interface SiteFile {
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
}

export interface UploadedSite {
  sizeBytes: number;
  fileCount: number;
  checksum: string;
}

/** Storage keys are POSIX regardless of the platform that produced them. */
export async function collectSiteFiles(rootDir: string): Promise<SiteFile[]> {
  const files: SiteFile[] = [];

  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const absolutePath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      files.push({
        relativePath: path.relative(rootDir, absolutePath).split(path.sep).join("/"),
        absolutePath,
        sizeBytes: (await stat(absolutePath)).size,
      });
    }
  }

  await walk(rootDir);
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function assertWithin(parentDir: string, candidate: string): void {
  const parent = path.resolve(parentDir);
  const target = path.resolve(candidate);

  if (target !== parent && !target.startsWith(parent + path.sep)) {
    throw new BuildFailure("The build wrote its output outside the project.");
  }
}

export function assertDeployable(files: SiteFile[], maxBytes: number): void {
  if (files.length === 0) {
    throw new BuildFailure("The build produced no files.");
  }

  if (files.length > MAX_FILES) {
    throw new BuildFailure(`The site has more than ${MAX_FILES} files.`);
  }

  if (!files.some((file) => file.relativePath === "index.html")) {
    throw new BuildFailure("No index.html at the root of the output.");
  }

  const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  if (totalBytes > maxBytes) {
    throw new BuildFailure(`The site is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  }
}

export async function uploadSite(
  storage: S3Client,
  bucket: string,
  deploymentId: string,
  files: SiteFile[],
): Promise<UploadedSite> {
  const digests = new Map<string, string>();
  const queue = [...files];

  const workers = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, async () => {
    for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
      const body = await readFile(file.absolutePath);

      await storage.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: siteKey(deploymentId, file.relativePath),
          Body: body,
          ContentType: contentTypeOf(file.relativePath),
        }),
      );

      digests.set(file.relativePath, createHash("sha256").update(body).digest("hex"));
    }
  });

  await Promise.all(workers);

  return {
    sizeBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
    fileCount: files.length,
    checksum: checksumOf(files, digests),
  };
}

/** Content addressing over the whole tree: same files in, same digest out. */
export function checksumOf(files: SiteFile[], digests: Map<string, string>): string {
  const manifest = files
    .map((file) => `${file.relativePath}:${digests.get(file.relativePath) ?? ""}\n`)
    .sort()
    .join("");

  return createHash("sha256").update(manifest).digest("hex");
}

export function contentTypeOf(relativePath: string): string {
  return mime.lookup(relativePath) || "application/octet-stream";
}
