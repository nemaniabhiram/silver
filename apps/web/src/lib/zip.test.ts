import { describe, expect, it } from "vitest";
import { type DroppedFile, archiveEntries, loneArchive, totalBytes } from "./zip.js";

function drop(...paths: string[]): DroppedFile[] {
  return paths.map((path) => ({
    path,
    file: new File([`contents of ${path}`], path.split("/").at(-1) ?? path),
  }));
}

function namesIn(files: DroppedFile[]): string[] {
  return archiveEntries(files).map(({ path }) => path);
}

describe("archiveEntries", () => {
  it("strips the wrapping folder a dropped directory nests everything under", () => {
    expect(namesIn(drop("site/index.html", "site/css/app.css"))).toEqual([
      "index.html",
      "css/app.css",
    ]);
  });

  it("keeps paths whole when the drop has more than one root", () => {
    expect(namesIn(drop("index.html", "assets/logo.svg"))).toEqual([
      "index.html",
      "assets/logo.svg",
    ]);
  });

  it("keeps the root when a file shares its name, since it is a file and not a folder", () => {
    expect(namesIn(drop("index.html"))).toEqual(["index.html"]);
  });

  it("pairs every entry with the file it came from", () => {
    const files = drop("site/index.html", "site/app.js");

    expect(archiveEntries(files).map(({ file }) => file)).toEqual(files.map(({ file }) => file));
  });

  /**
   * The root used to be resolved once per file, and each resolution scanned the
   * whole drop. A folder this size took 5.2 seconds of blocked main thread
   * before packing started. The bound is far above what the linear version
   * costs and far below what the quadratic one did, so it fails only on a real
   * regression.
   */
  it("resolves a five thousand file drop without rescanning it per file", () => {
    const many = drop(...Array.from({ length: 5000 }, (_, index) => `site/page-${index}.html`));

    const startedAt = performance.now();
    const names = namesIn(many);
    const elapsedMs = performance.now() - startedAt;

    expect(names).toHaveLength(5000);
    expect(names.at(-1)).toBe("page-4999.html");
    expect(elapsedMs).toBeLessThan(500);
  });
});

describe("loneArchive", () => {
  it("passes a single zip through rather than packing it again", () => {
    const files = drop("site.zip");

    expect(loneArchive(files)).toBe(files[0]?.file);
  });

  it("returns null when a zip arrives alongside other files", () => {
    expect(loneArchive(drop("site.zip", "index.html"))).toBeNull();
  });

  it("returns null for a folder that happens to hold one file", () => {
    expect(loneArchive(drop("site/index.html"))).toBeNull();
  });
});

describe("totalBytes", () => {
  it("sums the sizes of every file in the drop", () => {
    const files = drop("a.html", "b.html");

    expect(totalBytes(files)).toBe(files.reduce((sum, { file }) => sum + file.size, 0));
  });

  it("is zero for an empty drop", () => {
    expect(totalBytes([])).toBe(0);
  });
});
