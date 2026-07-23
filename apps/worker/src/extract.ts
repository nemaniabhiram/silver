import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { BuildFailure } from "./failure.js";

const MAX_ENTRIES = 5_000;
const UNIX_MODE_SHIFT = 16;
const FILE_TYPE_MASK = 0xf000;
const SYMLINK_TYPE = 0xa000;

/**
 * Where an entry is allowed to land, or null when it escapes the destination.
 * A zip may name `../../etc/passwd`; only the resolved path can prove it safe.
 */
export function resolveEntryPath(destDir: string, entryName: string): string | null {
  if (entryName.includes("\0")) {
    return null;
  }

  const root = path.resolve(destDir);
  const target = path.resolve(root, entryName);

  return target === root || target.startsWith(root + path.sep) ? target : null;
}

/**
 * The single top-level directory every entry sits under, if there is one.
 * Zipping a folder rather than its contents is the common case, and the user
 * means the folder's contents to be the site root.
 */
export function findSingleRoot(entryNames: string[]): string | null {
  const topLevel = new Set<string>();
  let hasTopLevelFile = false;

  for (const name of entryNames) {
    const normalized = name.replace(/\\/g, "/").replace(/^\/+/, "");
    if (normalized === "") {
      continue;
    }

    const [head, ...rest] = normalized.split("/");
    if (head === undefined || head === "") {
      continue;
    }

    if (rest.length === 0 || rest.join("/") === "") {
      if (!normalized.endsWith("/")) {
        hasTopLevelFile = true;
      }
      topLevel.add(head);
      continue;
    }

    topLevel.add(head);
  }

  if (hasTopLevelFile || topLevel.size !== 1) {
    return null;
  }

  return [...topLevel][0] ?? null;
}

export function isSymlink(externalAttributes: number): boolean {
  return ((externalAttributes >>> UNIX_MODE_SHIFT) & FILE_TYPE_MASK) === SYMLINK_TYPE;
}

/** Extracts into destDir and returns the directory the site actually starts at. */
export async function extractZip(
  zipPath: string,
  destDir: string,
  maxTotalBytes: number,
): Promise<string> {
  const entries = readEntries(zipPath);

  if (entries.length > MAX_ENTRIES) {
    throw new BuildFailure(`Zip holds more than ${MAX_ENTRIES} files.`);
  }

  let totalBytes = 0;
  for (const entry of entries) {
    totalBytes += entry.header.size;
    if (totalBytes > maxTotalBytes) {
      throw new BuildFailure("Zip expands to more than the allowed size.");
    }
    if (isSymlink(entry.header.attr)) {
      throw new BuildFailure("Zip contains symlinks, which aren't supported.");
    }
    if (resolveEntryPath(destDir, entry.entryName) === null) {
      throw new BuildFailure("Zip contains unsafe paths.");
    }
  }

  await mkdir(destDir, { recursive: true });

  for (const entry of entries) {
    const target = resolveEntryPath(destDir, entry.entryName);
    if (target === null) {
      throw new BuildFailure("Zip contains unsafe paths.");
    }

    if (entry.isDirectory) {
      await mkdir(target, { recursive: true });
      continue;
    }

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, entry.getData());
  }

  const singleRoot = findSingleRoot(entries.map((entry) => entry.entryName));
  return singleRoot ? path.join(destDir, singleRoot) : destDir;
}

function readEntries(zipPath: string): AdmZip.IZipEntry[] {
  try {
    return new AdmZip(zipPath).getEntries();
  } catch (error) {
    // The library's own wording names itself and its internals, which tells the
    // person who dropped the file nothing they can act on.
    console.error(`[worker] unreadable archive ${zipPath}`, error);
    throw new BuildFailure("That zip is damaged or incomplete. Try creating it again.");
  }
}
