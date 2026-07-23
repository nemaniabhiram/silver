import { open, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { RequestHandler } from "express";
import multer from "multer";
import type { Config } from "@silver/shared";

/** Local file header of a non-empty zip. */
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export function hasZipSignature(head: Buffer): boolean {
  return head.subarray(0, ZIP_SIGNATURE.length).equals(ZIP_SIGNATURE);
}

export async function looksLikeZip(filePath: string): Promise<boolean> {
  const file = await open(filePath, "r");
  try {
    const head = Buffer.alloc(ZIP_SIGNATURE.length);
    const { bytesRead } = await file.read(head, 0, head.length, 0);
    return bytesRead === head.length && hasZipSignature(head);
  } finally {
    await file.close();
  }
}

export function createUploadMiddleware(config: Config): RequestHandler {
  return multer({
    dest: tmpdir(),
    limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  }).single("file");
}

export async function discard(filePath: string | undefined): Promise<void> {
  if (!filePath) {
    return;
  }
  try {
    await unlink(filePath);
  } catch {
    // The upload already succeeded; a leftover temp file is not worth failing on.
  }
}
