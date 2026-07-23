import path from "node:path";
import { describe, expect, it } from "vitest";
import { findSingleRoot, isSymlink, resolveEntryPath } from "./extract.js";

const DEST = path.resolve("/tmp/silver-builds/abc1234567/src");

describe("resolveEntryPath", () => {
  it("keeps ordinary entries inside the destination", () => {
    expect(resolveEntryPath(DEST, "index.html")).toBe(path.join(DEST, "index.html"));
    expect(resolveEntryPath(DEST, "assets/app.js")).toBe(path.join(DEST, "assets", "app.js"));
  });

  it("refuses entries that climb out", () => {
    expect(resolveEntryPath(DEST, "../evil.txt")).toBeNull();
    expect(resolveEntryPath(DEST, "../../../../etc/passwd")).toBeNull();
    expect(resolveEntryPath(DEST, "assets/../../../evil.txt")).toBeNull();
  });

  it("refuses absolute entries", () => {
    expect(resolveEntryPath(DEST, "/etc/passwd")).toBeNull();
  });

  it("refuses null bytes, which can truncate a path downstream", () => {
    expect(resolveEntryPath(DEST, "index.html\0.png")).toBeNull();
  });

  it("allows traversal that stays within the destination", () => {
    expect(resolveEntryPath(DEST, "assets/../index.html")).toBe(path.join(DEST, "index.html"));
  });
});

describe("findSingleRoot", () => {
  it("finds the wrapper directory when a folder was zipped whole", () => {
    expect(findSingleRoot(["my-site/", "my-site/index.html", "my-site/style.css"])).toBe("my-site");
  });

  it("stays at the top when files sit at the root", () => {
    expect(findSingleRoot(["index.html", "style.css"])).toBeNull();
  });

  it("stays at the top when a root file accompanies a directory", () => {
    expect(findSingleRoot(["index.html", "assets/app.js"])).toBeNull();
  });

  it("stays at the top when several directories share the root", () => {
    expect(findSingleRoot(["site-a/index.html", "site-b/index.html"])).toBeNull();
  });

  it("reads windows-style separators the same way", () => {
    expect(findSingleRoot(["my-site\\index.html", "my-site\\assets\\app.js"])).toBe("my-site");
  });
});

describe("isSymlink", () => {
  it("recognises a symlink's unix mode", () => {
    expect(isSymlink(0xa1ff << 16)).toBe(true);
  });

  it("passes regular files and directories", () => {
    expect(isSymlink(0x81a4 << 16)).toBe(false);
    expect(isSymlink(0x41ed << 16)).toBe(false);
    expect(isSymlink(0)).toBe(false);
  });
});
