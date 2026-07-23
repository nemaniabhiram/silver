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

/**
 * Asking for `npm ci` without a lockfile prints a page of usage text before
 * falling back, which reads as a failure in the log the user is watching.
 * Choosing up front keeps the output honest, and && stops a failed install from
 * being followed by a build that was never going to work.
 */
const NPM_BUILD =
  "if [ -f package-lock.json ]; then npm ci; else npm install; fi && npm run build";

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
  {
    name: "vite",
    async detect(rootDir) {
      return hasDependency(await readPackageJson(rootDir), "vite");
    },
    buildCommand: NPM_BUILD,
    resolveOutputDir: expectDirectory("dist"),
  },
  {
    name: "cra",
    async detect(rootDir) {
      return hasDependency(await readPackageJson(rootDir), "react-scripts");
    },
    buildCommand: NPM_BUILD,
    resolveOutputDir: expectDirectory("build"),
  },
  {
    name: "npm",
    async detect(rootDir) {
      return hasBuildScript(await readPackageJson(rootDir));
    },
    buildCommand: NPM_BUILD,
    async resolveOutputDir(rootDir) {
      for (const candidate of ["dist", "build", "out", "public"]) {
        const directory = path.join(rootDir, candidate);
        if (await isDirectory(directory)) {
          return directory;
        }
      }
      throw new BuildFailure(
        "The build produced no dist, build, out or public directory.",
      );
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

export function hasDependency(
  packageJson: Record<string, unknown> | null,
  dependency: string,
): boolean {
  if (!packageJson) {
    return false;
  }

  return ["dependencies", "devDependencies"].some((field) => {
    const group = packageJson[field];
    return isRecord(group) && dependency in group;
  });
}

export function hasBuildScript(packageJson: Record<string, unknown> | null): boolean {
  const scripts = packageJson?.["scripts"];
  return isRecord(scripts) && typeof scripts["build"] === "string";
}

export async function readPackageJson(
  rootDir: string,
): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function expectDirectory(name: string) {
  return async (rootDir: string): Promise<string> => {
    const directory = path.join(rootDir, name);
    if (!(await isDirectory(directory))) {
      throw new BuildFailure(`The build produced no ${name}/ directory.`);
    }
    return directory;
  };
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
