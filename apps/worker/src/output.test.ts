import path from "node:path";
import { describe, expect, it } from "vitest";
import { BuildFailure } from "./failure.js";
import { assertDeployable, assertWithin, checksumOf, contentTypeOf, type SiteFile } from "./output.js";

function file(relativePath: string, sizeBytes = 10): SiteFile {
  return { relativePath, absolutePath: path.join("/site", relativePath), sizeBytes };
}

describe("assertWithin", () => {
  it("accepts an output directory inside the project", () => {
    expect(() => assertWithin("/site", "/site/dist")).not.toThrow();
    expect(() => assertWithin("/site", "/site")).not.toThrow();
  });

  it("rejects an output directory a package.json pointed elsewhere", () => {
    expect(() => assertWithin("/site", "/etc")).toThrow(BuildFailure);
    expect(() => assertWithin("/site", "/site/../secrets")).toThrow(BuildFailure);
  });

  it("is not fooled by a sibling with a shared prefix", () => {
    expect(() => assertWithin("/site", "/site-evil")).toThrow(BuildFailure);
  });
});

describe("assertDeployable", () => {
  const oneMb = 1024 * 1024;

  it("accepts a site with an index at the root", () => {
    expect(() => assertDeployable([file("index.html"), file("app.js")], oneMb)).not.toThrow();
  });

  it("rejects an empty output", () => {
    expect(() => assertDeployable([], oneMb)).toThrow(/no files/);
  });

  it("rejects output with no root index.html", () => {
    expect(() => assertDeployable([file("nested/index.html")], oneMb)).toThrow(/index\.html/);
  });

  it("rejects output past the size cap", () => {
    expect(() => assertDeployable([file("index.html", oneMb * 2)], oneMb)).toThrow(/larger than/);
  });
});

describe("checksumOf", () => {
  const files = [file("index.html"), file("app.js")];
  const digests = new Map([
    ["index.html", "aaa"],
    ["app.js", "bbb"],
  ]);

  it("is stable across runs", () => {
    expect(checksumOf(files, digests)).toBe(checksumOf(files, digests));
  });

  it("ignores the order files were walked in", () => {
    expect(checksumOf([...files].reverse(), digests)).toBe(checksumOf(files, digests));
  });

  it("changes when a file's contents change", () => {
    const changed = new Map(digests).set("app.js", "ccc");
    expect(checksumOf(files, changed)).not.toBe(checksumOf(files, digests));
  });

  it("changes when a file is renamed", () => {
    const renamed = [file("index.html"), file("main.js")];
    const renamedDigests = new Map([
      ["index.html", "aaa"],
      ["main.js", "bbb"],
    ]);
    expect(checksumOf(renamed, renamedDigests)).not.toBe(checksumOf(files, digests));
  });
});

describe("contentTypeOf", () => {
  it("names the types a browser refuses to guess", () => {
    expect(contentTypeOf("index.html")).toMatch(/^text\/html/);
    expect(contentTypeOf("app.js")).toMatch(/javascript/);
    expect(contentTypeOf("style.css")).toMatch(/^text\/css/);
    expect(contentTypeOf("pixel.png")).toBe("image/png");
    expect(contentTypeOf("font.woff2")).toMatch(/font/);
  });

  it("falls back rather than mislabel an unknown file", () => {
    expect(contentTypeOf("LICENSE")).toBe("application/octet-stream");
  });
});
