import JSZip from "jszip";

export interface DroppedFile {
  path: string;
  file: File;
}

const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", ".DS_Store"]);

/**
 * Entries must be read while the drop event is still being handled — the
 * DataTransfer is emptied as soon as the handler returns, so this is
 * deliberately synchronous and the traversal happens afterwards.
 */
export function entriesFrom(dataTransfer: DataTransfer): FileSystemEntry[] {
  return [...dataTransfer.items]
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null);
}

export async function filesFromEntries(entries: FileSystemEntry[]): Promise<DroppedFile[]> {
  const collected: DroppedFile[] = [];
  await Promise.all(entries.map((entry) => walk(entry, "", collected)));
  return collected;
}

export function filesFromInput(fileList: FileList): DroppedFile[] {
  return [...fileList]
    .map((file) => ({ path: file.webkitRelativePath || file.name, file }))
    .filter(({ path }) => !isIgnored(path));
}

/** A lone .zip is already what the api wants; anything else gets packed. */
export function loneArchive(files: DroppedFile[]): File | null {
  const [only] = files;
  return files.length === 1 && only && /\.zip$/i.test(only.file.name) ? only.file : null;
}

export async function zipFiles(files: DroppedFile[]): Promise<Blob> {
  const archive = new JSZip();

  for (const { path, file } of files) {
    archive.file(stripLeadingDirectory(path, files), file);
  }

  return archive.generateAsync({ type: "blob", compression: "DEFLATE" });
}

export function totalBytes(files: DroppedFile[]): number {
  return files.reduce((sum, { file }) => sum + file.size, 0);
}

async function walk(
  entry: FileSystemEntry,
  prefix: string,
  collected: DroppedFile[],
): Promise<void> {
  if (IGNORED_DIRECTORIES.has(entry.name)) {
    return;
  }

  const path = prefix ? `${prefix}/${entry.name}` : entry.name;

  if (entry.isFile) {
    collected.push({ path, file: await readFile(entry as FileSystemFileEntry) });
    return;
  }

  const children = await readDirectory(entry as FileSystemDirectoryEntry);
  await Promise.all(children.map((child) => walk(child, path, collected)));
}

function readFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/** readEntries returns at most 100 at a time and must be called until empty. */
async function readDirectory(entry: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = entry.createReader();
  const entries: FileSystemEntry[] = [];

  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );

    if (batch.length === 0) {
      return entries;
    }

    entries.push(...batch);
  }
}

function isIgnored(path: string): boolean {
  return path.split("/").some((segment) => IGNORED_DIRECTORIES.has(segment));
}

/**
 * Dropping a folder nests everything under its name. The worker unwraps a
 * single root too, but doing it here keeps what the user sees honest.
 */
function stripLeadingDirectory(path: string, files: DroppedFile[]): string {
  const root = commonRoot(files);
  return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

function commonRoot(files: DroppedFile[]): string | null {
  const roots = new Set(files.map(({ path }) => path.split("/")[0] ?? ""));
  const [only] = [...roots];

  if (roots.size !== 1 || !only) {
    return null;
  }

  return files.some(({ path }) => path === only) ? null : only;
}
