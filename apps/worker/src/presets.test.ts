import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BuildFailure } from "./failure.js";
import { PRESETS, hasBuildScript, hasDependency, selectPreset } from "./presets.js";

async function project(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "silver-preset-"));

  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  }

  return root;
}

const packageJson = (value: unknown) => JSON.stringify(value);

describe("hasDependency", () => {
  it("looks in both dependency groups", () => {
    expect(hasDependency({ dependencies: { vite: "^6" } }, "vite")).toBe(true);
    expect(hasDependency({ devDependencies: { vite: "^6" } }, "vite")).toBe(true);
  });

  it("says no when absent or unreadable", () => {
    expect(hasDependency({ dependencies: { react: "^18" } }, "vite")).toBe(false);
    expect(hasDependency(null, "vite")).toBe(false);
    expect(hasDependency({ dependencies: "not-an-object" }, "vite")).toBe(false);
  });
});

describe("hasBuildScript", () => {
  it("requires a build script that is actually a command", () => {
    expect(hasBuildScript({ scripts: { build: "vite build" } })).toBe(true);
    expect(hasBuildScript({ scripts: { test: "vitest" } })).toBe(false);
    expect(hasBuildScript({ scripts: { build: 42 } })).toBe(false);
    expect(hasBuildScript(null)).toBe(false);
  });
});

describe("selectPreset", () => {
  it("treats plain files as a static site", async () => {
    const root = await project({ "index.html": "<h1>hi</h1>" });
    expect((await selectPreset(root, null)).name).toBe("static");
  });

  it("recognises a vite project", async () => {
    const root = await project({
      "package.json": packageJson({ devDependencies: { vite: "^6" }, scripts: { build: "vite build" } }),
      "index.html": "<div id=app></div>",
    });
    expect((await selectPreset(root, null)).name).toBe("vite");
  });

  it("recognises create-react-app", async () => {
    const root = await project({
      "package.json": packageJson({ dependencies: { "react-scripts": "5" }, scripts: { build: "react-scripts build" } }),
    });
    expect((await selectPreset(root, null)).name).toBe("cra");
  });

  it("falls back to a plain npm build", async () => {
    const root = await project({
      "package.json": packageJson({ scripts: { build: "make site" } }),
    });
    expect((await selectPreset(root, null)).name).toBe("npm");
  });

  it("prefers a build over serving sources when both could apply", async () => {
    const root = await project({
      "package.json": packageJson({ devDependencies: { vite: "^6" }, scripts: { build: "vite build" } }),
      "index.html": "<div id=app></div>",
    });
    expect((await selectPreset(root, null)).name).not.toBe("static");
  });

  it("honours an explicit override", async () => {
    const root = await project({ "index.html": "<h1>hi</h1>" });
    expect((await selectPreset(root, "npm")).name).toBe("npm");
  });

  it("explains itself when nothing matches", async () => {
    const root = await project({ "readme.txt": "nothing deployable" });
    await expect(selectPreset(root, null)).rejects.toThrow(BuildFailure);
  });
});

describe("resolveOutputDir", () => {
  const presetNamed = (name: string) => PRESETS.find((preset) => preset.name === name)!;

  it("points vite at dist", async () => {
    const root = await project({ "dist/index.html": "<h1>built</h1>" });
    expect(await presetNamed("vite").resolveOutputDir(root)).toBe(path.join(root, "dist"));
  });

  it("points cra at build", async () => {
    const root = await project({ "build/index.html": "<h1>built</h1>" });
    expect(await presetNamed("cra").resolveOutputDir(root)).toBe(path.join(root, "build"));
  });

  it("names the missing directory when a build produced nothing", async () => {
    const root = await project({ "package.json": "{}" });
    await expect(presetNamed("vite").resolveOutputDir(root)).rejects.toThrow(/no dist\/ directory/);
  });

  it("takes the first conventional directory a plain npm build wrote", async () => {
    const root = await project({ "out/index.html": "<h1>built</h1>" });
    expect(await presetNamed("npm").resolveOutputDir(root)).toBe(path.join(root, "out"));
  });

  it("serves static sites from where they already are", async () => {
    const root = await project({ "index.html": "<h1>hi</h1>" });
    expect(await presetNamed("static").resolveOutputDir(root)).toBe(root);
  });
});
