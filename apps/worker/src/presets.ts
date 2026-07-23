import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { BuildFailure } from "./failure.js";

export interface Preset {
  readonly name: string;
  detect(rootDir: string): Promise<boolean>;
  /** null means the files are already the site; nothing to run. */
  readonly buildCommand: string | null;
  resolveOutputDir(rootDir: string): Promise<string>;
}

const NPM_BUILD = "npm ci || npm install; npm run build";

/**
 * Ordered by specificity — the first preset whose detect() passes wins.
 * Supporting a new framework means appending one object here; nothing in the
 * pipeline, the poll loop, or the sandbox names a preset.
 */
export const PRESETS: readonly Preset[] = [
  {
    name: "static",
    async detect(rootDir) {
      return !(await exists(path.join(rootDir, "package.json"))) &&
        (await exists(path.join(rootDir, "index.html")));
    },
    buildCommand: null,
    async resolveOutputDir(rootDir) {
      return rootDir;
    },
  },
];

export async function selectPreset(
  rootDir: string,
  requestedName: string | null,
): Promise<Preset> {
  if (requestedName !== null) {
    const requested = PRESETS.find((preset) => preset.name === requestedName);
    if (!requested) {
      throw new BuildFailure(`Unknown preset "${requestedName}".`);
    }
    return requested;
  }

  for (const preset of PRESETS) {
    if (await preset.detect(rootDir)) {
      return preset;
    }
  }

  throw new BuildFailure(
    "Could not detect a deployable site. Drop a folder with an index.html, or a project with a build script.",
  );
}

export async function readPackageJson(
  rootDir: string,
): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

export async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export const NPM_BUILD_COMMAND = NPM_BUILD;
